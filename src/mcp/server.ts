/**
 * Servidor MCP (Model Context Protocol) para GhostDeps.
 * Permite que agentes de IA como Claude Desktop, Cursor, Gemini CLI o ChatGPT
 * llamen a GhostDeps como una herramienta (tool) a través de stdio (JSON-RPC 2.0).
 */
import readline from 'node:readline';
import path from 'node:path';
import { analyzeAll, sortReports, summarize } from '../analyzer.js';
import { DiskCache, defaultCacheDir } from '../clients/cache.js';
import { GitHubClient } from '../clients/github.js';
import { RateLimitGate } from '../clients/http.js';
import { NpmClient } from '../clients/npm.js';
import { createIgnoreMatcher, loadConfig } from '../config.js';
import { readLockfile, resolveTransitive } from '../parser/lockfile.js';
import { readManifest } from '../parser/manifest.js';
import { renderMarkdown } from '../render/markdown.js';
import type { DependencySpec } from '../types.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export function createAuditToolDefinition() {
  return {
    name: 'ghostdeps_audit',
    description:
      'Audita la salud social, de mantenimiento y ciberseguridad de las dependencias de un proyecto Node.js / JavaScript. ' +
      'Detecta paquetes abandonados, bus factor crítico (0 o 1 mantenedor), repositorios archivados y posibles señales de secuestro (hijacking).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Ruta al directorio que contiene el package.json (por defecto el directorio actual).',
        },
        dev: {
          type: 'boolean',
          description: 'Incluir también devDependencies en el análisis.',
        },
        transitive: {
          type: 'boolean',
          description: 'Incluir dependencias transitivas leyendo package-lock.json o yarn.lock.',
        },
        depth: {
          type: 'integer',
          description: 'Profundidad máxima para dependencias transitivas (1 = solo directas).',
        },
        failUnder: {
          type: 'number',
          description: 'Umbral mínimo de Health Score (0 a 100).',
        },
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de nombres o patrones comodín a ignorar (ej: ["@types/*"]).',
        },
      },
    },
  };
}

export async function executeMcpAudit(args: Record<string, unknown> = {}, version: string): Promise<string> {
  const targetDir = typeof args.path === 'string' && args.path ? path.resolve(args.path) : process.cwd();
  const includeDev = Boolean(args.dev);
  const includeTransitive = Boolean(args.transitive);
  const depth = typeof args.depth === 'number' ? args.depth : undefined;
  const failUnder = typeof args.failUnder === 'number' ? args.failUnder : undefined;
  const ignoreList = Array.isArray(args.ignore) ? (args.ignore.filter((i) => typeof i === 'string') as string[]) : [];

  const config = await loadConfig(targetDir);
  const isIgnored = createIgnoreMatcher([...config.ignore, ...ignoreList]);

  const manifest = await readManifest(targetDir, { includeDev: includeDev || (config.dev ?? false) });
  let all: DependencySpec[] = manifest.dependencies;

  if (includeTransitive || config.transitive) {
    try {
      const { lock } = await readLockfile(targetDir);
      const trans = resolveTransitive(lock, manifest.dependencies, {
        maxDepth: depth ?? config.depth ?? Number.POSITIVE_INFINITY,
      });
      all = [...manifest.dependencies, ...trans];
    } catch (err) {
      process.stderr.write(`[GhostDeps MCP] Advertencia al leer lockfile: ${(err as Error).message}\n`);
    }
  }

  const ignored = all.filter((d) => isIgnored(d.name) || isIgnored(d.registryName)).map((d) => d.name);
  const toAnalyze = all.filter((d) => !ignored.includes(d.name));

  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || undefined;
  const userAgent = `ghostdeps/${version} (+https://github.com/ghostdeps/ghostdeps)`;
  const cache = new DiskCache(defaultCacheDir(), 24 * 3_600_000, true);
  const gate = new RateLimitGate();
  const now = new Date();

  const npm = new NpmClient({ cache, timeoutMs: 15_000, retries: 3, userAgent });
  const github = new GitHubClient({
    cache,
    token,
    timeoutMs: 15_000,
    retries: 3,
    userAgent,
    gate,
    maxRateLimitWaitMs: 30_000,
    now: () => now,
  });

  const reports = await analyzeAll(
    toAnalyze,
    { npm, github, now, weights: config.weights, thresholds: config.thresholds },
    config.concurrency ?? 4,
  );

  const sorted = sortReports(reports);
  const summary = summarize(sorted);
  const failing =
    failUnder === undefined
      ? []
      : sorted.filter((r) => r.status === 'evaluated' && r.result && r.result.score < failUnder).map((r) => r.name);

  return renderMarkdown(sorted, summary, now, {
    version,
    projectName: manifest.projectName,
    thresholds: config.thresholds,
    failUnder,
    failing,
    ignored,
  });
}

export function startMcpServer(version: string): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const sendResponse = (id: number | string | undefined, result: unknown) => {
    if (id === undefined) return;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
    process.stdout.write(`${msg}\n`);
  };

  const sendError = (id: number | string | undefined, code: number, message: string) => {
    if (id === undefined) return;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
    process.stdout.write(`${msg}\n`);
  };

  process.stderr.write(`[GhostDeps MCP Server] Iniciado sobre stdio (v${version})\n`);

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      sendError(undefined, -32700, 'Parse error: invalid JSON');
      return;
    }

    const { id, method, params } = req;

    try {
      if (method === 'initialize') {
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: '@efraindrummer/ghostdeps',
            version,
          },
        });
        return;
      }

      if (method === 'notifications/initialized') {
        // Notificación del cliente, no requiere respuesta
        return;
      }

      if (method === 'ping') {
        sendResponse(id, {});
        return;
      }

      if (method === 'tools/list') {
        sendResponse(id, {
          tools: [createAuditToolDefinition()],
        });
        return;
      }

      if (method === 'tools/call') {
        const toolName = params?.name;
        if (toolName !== 'ghostdeps_audit') {
          sendError(id, -32601, `Herramienta desconocida: ${toolName}`);
          return;
        }

        const args = (params?.arguments as Record<string, unknown>) ?? {};
        const markdown = await executeMcpAudit(args, version);

        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
          isError: false,
        });
        return;
      }

      // Método no implementado
      sendError(id, -32601, `Método no soportado: ${method}`);
    } catch (err) {
      sendError(id, -32603, `Error interno ejecutando ${method}: ${(err as Error).message}`);
    }
  });
}
