#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { analyzeAll, sortReports, summarize } from './analyzer.js';
import { DiskCache, defaultCacheDir } from './clients/cache.js';
import { GitHubClient } from './clients/github.js';
import { RateLimitGate } from './clients/http.js';
import { NpmClient } from './clients/npm.js';
import { GhostDepsError, errorMessage } from './errors.js';
import { readManifest } from './parser/manifest.js';
import { renderExplain, renderSummary, renderTable } from './render/table.js';

/** Códigos de salida documentados. */
export const EXIT = { OK: 0, FAIL_UNDER: 1, FATAL: 2 } as const;

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

interface CliOptions {
  path: string;
  dev: boolean;
  json: boolean;
  failUnder?: number;
  concurrency: number;
  cache: boolean;
  cacheTtl: number;
  timeout: number;
  maxWait: number;
  explain: boolean;
}

const log = (msg: string) => process.stderr.write(`${msg}\n`);

async function run(opts: CliOptions, version: string): Promise<number> {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || undefined;
  if (!token) {
    log(
      chalk.yellow(
        '⚠ GITHUB_TOKEN no configurado: la API de GitHub permite solo 60 peticiones/hora sin autenticar\n' +
          '  (~15 paquetes). Crea un token sin permisos en https://github.com/settings/tokens y exporta GITHUB_TOKEN.',
      ),
    );
  }

  const manifest = await readManifest(opts.path, { includeDev: opts.dev });
  if (manifest.dependencies.length === 0) {
    if (opts.json) process.stdout.write(`${JSON.stringify({ packages: [], summary: summarize([]) }, null, 2)}\n`);
    else log(chalk.green(`No hay dependencias que analizar en ${manifest.manifestPath}.`));
    return EXIT.OK;
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

  const interactive = !opts.json && process.stderr.isTTY;
  const reports = await analyzeAll(manifest.dependencies, { npm, github, now }, opts.concurrency, (done, total, name) => {
    if (interactive) process.stderr.write(`\r\x1b[2K${chalk.gray(`Analizando ${done}/${total}: ${name}`)}`);
  });
  if (interactive) process.stderr.write('\r\x1b[2K');

  const sorted = sortReports(reports);
  const summary = summarize(sorted);

  const failing =
    opts.failUnder === undefined
      ? []
      : sorted.filter((r) => r.status === 'evaluated' && r.result && r.result.score < (opts.failUnder as number));

  if (opts.json) {
    const output = {
      tool: 'ghostdeps',
      version,
      generatedAt: now.toISOString(),
      manifest: manifest.manifestPath,
      options: { dev: opts.dev, failUnder: opts.failUnder ?? null, authenticated: Boolean(token) },
      summary,
      failUnder: opts.failUnder === undefined ? null : { threshold: opts.failUnder, failing: failing.map((r) => r.name) },
      packages: sorted,
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    const title = manifest.projectName ? ` · ${manifest.projectName}` : '';
    process.stdout.write(`${chalk.bold(`\n👻 GhostDeps v${version}${title}`)}\n`);
    process.stdout.write(`${renderTable(sorted, now)}\n`);
    process.stdout.write(`${renderSummary(summary)}\n`);
    if (opts.explain) process.stdout.write(`${renderExplain(sorted)}\n`);
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

  if (opts.failUnder !== undefined) {
    if (failing.length > 0) {
      log(chalk.red(`\n✖ ${failing.length} paquete(s) por debajo de --fail-under ${opts.failUnder}: ${failing.map((r) => r.name).join(', ')}`));
      return EXIT.FAIL_UNDER;
    }
    if (!opts.json) log(chalk.green(`\n✔ Ningún paquete evaluado por debajo de ${opts.failUnder}.`));
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
    .option('-d, --dev', 'incluir también devDependencies', false)
    .option('--json', 'salida en JSON (stdout) para integraciones', false)
    .option('--fail-under <score>', 'exit code 1 si algún paquete evaluado queda por debajo del score', scoreArg)
    .option('-c, --concurrency <n>', 'paquetes analizados en paralelo', positiveInt('--concurrency', 32), 4)
    .option('--no-cache', 'ignorar y no escribir la caché en disco')
    .option('--cache-ttl <hours>', 'TTL de la caché en horas', positiveInt('--cache-ttl'), 24)
    .option('--timeout <ms>', 'timeout por request en milisegundos', positiveInt('--timeout'), 15_000)
    .option('--max-wait <seconds>', 'espera máxima ante rate limit antes de abortar', positiveInt('--max-wait'), 60)
    .option('--explain', 'mostrar el desglose de penalizaciones de cada paquete', false)
    .addHelpText(
      'after',
      '\nVariables de entorno:\n  GITHUB_TOKEN          token de GitHub (recomendado; 5000 req/h)\n  GHOSTDEPS_CACHE_DIR   directorio de caché personalizado\n\nCódigos de salida: 0 OK · 1 --fail-under incumplido · 2 error fatal',
    )
    .action(async (opts: CliOptions) => {
      process.exitCode = await run(opts, version);
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
