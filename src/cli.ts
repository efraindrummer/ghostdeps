#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import chalk from 'chalk';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { analyzeWithAi, detectAiConfig, type AiProvider } from './ai/advisor.js';
import { analyzeAll, sortReports, summarize } from './analyzer.js';
import { DiskCache, defaultCacheDir } from './clients/cache.js';
import { GitHubClient } from './clients/github.js';
import { RateLimitGate } from './clients/http.js';
import { NpmClient } from './clients/npm.js';
import { createIgnoreMatcher, loadConfig } from './config.js';
import { GhostDepsError, errorMessage } from './errors.js';
import { startMcpServer } from './mcp/server.js';
import { readLockfile, resolveTransitive } from './parser/lockfile.js';
import { readManifest } from './parser/manifest.js';
import { renderMarkdown } from './render/markdown.js';
import { renderSarif } from './render/sarif.js';
import { renderExplain, renderSummary, renderTable } from './render/table.js';
import type { DependencySpec } from './types.js';

/** Códigos de salida documentados. */
export const EXIT = { OK: 0, FAIL_UNDER: 1, FATAL: 2 } as const;

type OutputFormat = 'table' | 'json' | 'markdown' | 'sarif';

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function positiveInt(name: string, max = Number.MAX_SAFE_INTEGER) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new InvalidArgumentError(`${name} debe ser un entero entre 1 y ${max}.`);
    }
    return n;
  };
}

function scoreArg(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new InvalidArgumentError('Debe ser un número entre 0 y 100.');
  return n;
}

/** `--ignore a,b --ignore "@types/*"` => ["a", "b", "@types/*"] */
function collectList(value: string, previous: string[] = []): string[] {
  return [...previous, ...value.split(',').map((s) => s.trim()).filter(Boolean)];
}

interface CliOptions {
  path: string;
  config?: string;
  dev: boolean;
  transitive: boolean;
  depth?: number;
  ignore: string[];
  json: boolean;
  format: OutputFormat;
  output?: string;
  failUnder?: number;
  concurrency: number;
  cache: boolean;
  cacheTtl: number;
  timeout: number;
  maxWait: number;
  explain: boolean;
  mcp: boolean;
  ai: boolean;
  aiProvider?: AiProvider;
  aiModel?: string;
}

const log = (msg: string) => process.stderr.write(`${msg}\n`);

async function run(opts: CliOptions, command: Command, version: string): Promise<number> {
  if (opts.mcp) {
    startMcpServer(version);
    return new Promise(() => {}); // Escuchar indefinidamente sobre stdio
  }

  const fromCli = (key: keyof CliOptions) => command.getOptionValueSource(key) === 'cli';
  const format: OutputFormat = opts.json ? 'json' : opts.format;
  const quiet = format !== 'table'; // en json/markdown, stderr solo para avisos importantes

  // --- Configuración efectiva: CLI > archivo > defaults ---
  const config = await loadConfig(opts.path, opts.config);
  const dev = fromCli('dev') ? opts.dev : (config.dev ?? opts.dev);
  const transitive = fromCli('transitive') ? opts.transitive : (config.transitive ?? opts.transitive);
  const depth = opts.depth ?? config.depth;
  const concurrency = fromCli('concurrency') ? opts.concurrency : (config.concurrency ?? opts.concurrency);
  const failUnder = opts.failUnder ?? config.failUnder;
  const isIgnored = createIgnoreMatcher([...config.ignore, ...opts.ignore]);

  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || undefined;
  if (!token) {
    log(
      chalk.yellow(
        '⚠ GITHUB_TOKEN no configurado: la API de GitHub permite solo 60 peticiones/hora sin autenticar\n' +
          '  (~15 paquetes). Crea un token sin permisos en https://github.com/settings/tokens y exporta GITHUB_TOKEN.',
      ),
    );
  }
  if (config.source && !quiet) log(chalk.gray(`Configuración: ${config.source}`));

  // --- Dependencias a analizar ---
  const manifest = await readManifest(opts.path, { includeDev: dev });
  let all: DependencySpec[] = manifest.dependencies;
  if (transitive) {
    const { file, lock } = await readLockfile(opts.path);
    const trans = resolveTransitive(lock, manifest.dependencies, { maxDepth: depth ?? Number.POSITIVE_INFINITY });
    all = [...manifest.dependencies, ...trans];
    if (!quiet) log(chalk.gray(`Transitivas: ${trans.length} desde ${path.basename(file)}${depth ? ` (profundidad ≤ ${depth})` : ''}`));
  }
  const ignored = all.filter((d) => isIgnored(d.name) || isIgnored(d.registryName)).map((d) => d.name);
  const toAnalyze = all.filter((d) => !ignored.includes(d.name));
  if (ignored.length > 0 && !quiet) log(chalk.gray(`Ignorados: ${ignored.join(', ')}`));

  if (toAnalyze.length > 15 && !token) {
    log(chalk.yellow(`⚠ ${toAnalyze.length} paquetes a analizar sin token: es muy probable agotar el rate limit.`));
  } else if (toAnalyze.length > 300) {
    log(chalk.yellow(`⚠ ${toAnalyze.length} paquetes: ~${toAnalyze.length * 3} peticiones a GitHub. Considera --depth o "ignore".`));
  }

  const userAgent = `ghostdeps/${version} (+https://github.com/ghostdeps/ghostdeps)`;
  const cache = new DiskCache(defaultCacheDir(), opts.cacheTtl * 3_600_000, opts.cache);
  const gate = new RateLimitGate();
  const retries = 3;
  const now = new Date();

  const npm = new NpmClient({ cache, timeoutMs: opts.timeout, retries, userAgent });
  const github = new GitHubClient({
    cache,
    token,
    timeoutMs: opts.timeout,
    retries,
    userAgent,
    gate,
    maxRateLimitWaitMs: opts.maxWait * 1000,
    onRateLimitWait: (ms, resetAt) =>
      log(chalk.yellow(`\n⏳ Rate limit de GitHub alcanzado; esperando ${Math.ceil(ms / 1000)} s (reset ${resetAt.toLocaleTimeString()})…`)),
    now: () => now,
  });

  const interactive = !quiet && process.stderr.isTTY;
  const reports = await analyzeAll(
    toAnalyze,
    { npm, github, now, weights: config.weights, thresholds: config.thresholds },
    concurrency,
    (done, total, name) => {
      if (interactive) process.stderr.write(`\r\x1b[2K${chalk.gray(`Analizando ${done}/${total}: ${name}`)}`);
    },
  );
  if (interactive) process.stderr.write('\r\x1b[2K');

  const sorted = sortReports(reports);
  const summary = summarize(sorted);
  const failing =
    failUnder === undefined
      ? []
      : sorted.filter((r) => r.status === 'evaluated' && r.result && r.result.score < failUnder).map((r) => r.name);

  // --- Asesor de Ciberseguridad IA ---
  let aiResult = null;
  if (opts.ai) {
    const hasRisks = sorted.some((r) => r.status === 'evaluated' && r.result && r.result.score < 70);
    const aiConfig = detectAiConfig({ provider: opts.aiProvider, model: opts.aiModel });
    if (!aiConfig) {
      log(
        chalk.yellow(
          '\n⚠ Modo --ai activado pero no se detectó ninguna clave de API.\n' +
            '  Exporta GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY en tu entorno.',
        ),
      );
    } else if (!hasRisks) {
      if (!quiet) log(chalk.green('\n🤖 IA: Todas las dependencias están saludables (score ≥ 70). No se requieren reemplazos.'));
    } else {
      if (!quiet) log(chalk.cyan(`\n🤖 Consultando a ${aiConfig.provider} (${aiConfig.model}) para análisis de mitigación y reemplazos...`));
      try {
        aiResult = await analyzeWithAi(sorted, summary, { provider: opts.aiProvider, model: opts.aiModel });
      } catch (err) {
        log(chalk.red(`\n✖ Error consultando a la IA: ${(err as Error).message}`));
      }
    }
  }

  // --- Salida ---
  let rendered: string;
  if (format === 'json') {
    rendered = JSON.stringify(
      {
        tool: 'ghostdeps',
        version,
        generatedAt: now.toISOString(),
        manifest: manifest.manifestPath,
        config: config.source,
        options: { dev, transitive, depth: depth ?? null, failUnder: failUnder ?? null, authenticated: Boolean(token), ai: opts.ai },
        thresholds: config.thresholds,
        summary,
        ignored,
        failUnder: failUnder === undefined ? null : { threshold: failUnder, failing },
        aiAnalysis: aiResult,
        packages: sorted,
      },
      null,
      2,
    );
  } else if (format === 'markdown') {
    rendered = renderMarkdown(sorted, summary, now, {
      version,
      projectName: manifest.projectName,
      thresholds: config.thresholds,
      failUnder,
      failing,
      ignored,
    });
    if (aiResult) {
      rendered += `\n\n### 🤖 Recomendaciones de Ciberseguridad (${aiResult.provider} / ${aiResult.model})\n\n${aiResult.analysis}\n`;
    }
  } else if (format === 'sarif') {
    rendered = renderSarif(sorted, {
      version,
      manifestPath: manifest.manifestPath,
      thresholds: config.thresholds,
    });
  } else {
    const title = manifest.projectName ? ` · ${manifest.projectName}` : '';
    const parts = [
      chalk.bold(`\n👻 GhostDeps v${version}${title}`),
      renderTable(sorted, now),
      renderSummary(summary, config.thresholds),
      ...(opts.explain ? [renderExplain(sorted)] : []),
    ];
    if (aiResult) {
      parts.push(chalk.bold.cyan(`\n🤖 Recomendaciones de Ciberseguridad (${aiResult.provider} / ${aiResult.model}):`));
      parts.push(aiResult.analysis);
    }
    rendered = parts.join('\n');
  }

  if (opts.output) {
    const file = path.resolve(opts.output);
    await writeFile(file, `${stripVTControlCharacters(rendered)}\n`, 'utf8');
    log(chalk.green(`✔ Informe escrito en ${file}`));
  } else {
    process.stdout.write(`${rendered}\n`);
  }

  if (gate.resetAt && gate.resetAt.getTime() > Date.now() && summary.errors > 0) {
    log(
      chalk.red(
        `\n✖ Se agotó el rate limit de GitHub (reset ${gate.resetAt.toLocaleTimeString()}). ` +
          'Los paquetes restantes quedaron como error; reintenta luego (los resultados ya obtenidos están en caché) ' +
          (token ? 'o aumenta --max-wait.' : 'o configura GITHUB_TOKEN.'),
      ),
    );
  }

  if (failUnder !== undefined) {
    if (failing.length > 0) {
      log(chalk.red(`\n✖ ${failing.length} paquete(s) por debajo de --fail-under ${failUnder}: ${failing.join(', ')}`));
      return EXIT.FAIL_UNDER;
    }
    if (!quiet) log(chalk.green(`\n✔ Ningún paquete evaluado por debajo de ${failUnder}.`));
  }
  return EXIT.OK;
}

async function main(): Promise<void> {
  const version = readVersion();
  const program = new Command();

  program
    .name('ghostdeps')
    .description('Detecta dependencias fantasma: abandonadas, con bus factor bajo o con señales de secuestro.')
    .version(version, '-v, --version')
    .option('-p, --path <dir>', 'directorio que contiene el package.json', process.cwd())
    .option('--config <file>', 'archivo de configuración (por defecto .ghostdepsrc.json o "ghostdeps" en package.json)')
    .option('-d, --dev', 'incluir también devDependencies', false)
    .option('-t, --transitive', 'incluir dependencias transitivas (requiere package-lock.json)', false)
    .option('--depth <n>', 'profundidad máxima con --transitive (1 = solo directas)', positiveInt('--depth', 100))
    .option('-i, --ignore <paquetes>', 'paquetes a omitir, separados por coma; admite * (ej. "@types/*")', collectList, [])
    .addOption(
      new Option('-f, --format <formato>', 'formato de salida').choices(['table', 'json', 'markdown', 'sarif']).default('table'),
    )
    .option('--json', 'atajo de --format json', false)
    .option('-o, --output <file>', 'escribir el informe en un archivo en lugar de stdout')
    .option('--fail-under <score>', 'exit code 1 si algún paquete evaluado queda por debajo del score', scoreArg)
    .option('-c, --concurrency <n>', 'paquetes analizados en paralelo', positiveInt('--concurrency', 32), 4)
    .option('--no-cache', 'ignorar y no escribir la caché en disco')
    .option('--cache-ttl <hours>', 'TTL de la caché en horas', positiveInt('--cache-ttl'), 24)
    .option('--timeout <ms>', 'timeout por request en milisegundos', positiveInt('--timeout'), 15_000)
    .option('--max-wait <seconds>', 'espera máxima ante rate limit antes de abortar', positiveInt('--max-wait'), 60)
    .option('--explain', 'mostrar el desglose de penalizaciones de cada paquete', false)
    .option('--ai', 'analizar dependencias con IA para sugerir reemplazos y plan de mitigación', false)
    .addOption(
      new Option('--ai-provider <provider>', 'proveedor de IA a utilizar').choices(['gemini', 'anthropic', 'openai']),
    )
    .option('--ai-model <model>', 'modelo específico de IA a consultar')
    .option('--mcp', 'iniciar servidor MCP (Model Context Protocol) sobre stdio para agentes de IA', false)
    .addHelpText(
      'after',
      [
        '',
        'Ejemplos:',
        '  ghostdeps --dev --explain',
        '  ghostdeps --transitive --depth 3 --ignore "@types/*"',
        '  ghostdeps --ai',
        '  ghostdeps --mcp',
        '  ghostdeps --format markdown -o ghostdeps.md',
        '  ghostdeps --fail-under 40',
        '',
        'Variables de entorno:',
        '  GITHUB_TOKEN / GH_TOKEN     token de GitHub (recomendado; 5000 req/h)',
        '  GEMINI_API_KEY              clave para modo --ai con Google Gemini',
        '  ANTHROPIC_API_KEY           clave para modo --ai con Anthropic Claude',
        '  OPENAI_API_KEY              clave para modo --ai con OpenAI ChatGPT',
        '  GHOSTDEPS_CACHE_DIR         directorio de caché personalizado',
        '',
        'Códigos de salida: 0 OK · 1 --fail-under incumplido · 2 error fatal',
      ].join('\n'),
    )
    .action(async (opts: CliOptions, command: Command) => {
      process.exitCode = await run(opts, command, version);
    });

  // Evita que Commander haga process.exit(1) en errores de uso (colisionaría con --fail-under).
  program.exitOverride();

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // Commander ya imprimió el mensaje (o la ayuda/versión).
      process.exitCode = err.exitCode === 0 ? EXIT.OK : EXIT.FATAL;
      return;
    }
    const msg = err instanceof GhostDepsError ? err.message : `Error inesperado: ${errorMessage(err)}`;
    log(chalk.red(`✖ ${msg}`));
    process.exitCode = EXIT.FATAL;
  }
}

void main();
