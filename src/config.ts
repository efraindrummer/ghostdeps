/**
 * Configuración por proyecto. Se busca, en orden:
 *   1. el archivo indicado con --config
 *   2. .ghostdepsrc.json o .ghostdepsrc (JSON) en el directorio analizado
 *   3. la clave "ghostdeps" del package.json
 * Precedencia final: flags de CLI > archivo de configuración > valores por defecto.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ConfigError } from './errors.js';
import { DEFAULT_WEIGHTS, THRESHOLDS, type ScoringWeights, type Thresholds, type Tier } from './scoring/scoring.js';

export interface GhostDepsConfig {
  /** Ruta del archivo de donde se cargó (o null si se usan solo defaults). */
  source: string | null;
  ignore: string[];
  failUnder?: number;
  dev?: boolean;
  transitive?: boolean;
  depth?: number;
  concurrency?: number;
  weights: ScoringWeights;
  thresholds: Thresholds;
  allowedLicenses?: string[];
  deniedLicenses?: string[];
  webhook?: string;
}

export const CONFIG_FILES = ['.ghostdepsrc.json', '.ghostdepsrc'] as const;

const TOP_LEVEL_KEYS = [
  '$schema',
  'ignore',
  'failUnder',
  'dev',
  'transitive',
  'depth',
  'concurrency',
  'weights',
  'thresholds',
  'allowedLicenses',
  'deniedLicenses',
  'webhook',
];
const NUMERIC_WEIGHTS = [
  'archived',
  'deprecated',
  'repoRedirect',
  'maintainersChanged',
  'newPublisher',
  'hijackPattern',
  'dormantRevivalDays',
  'suspiciousScripts',
  'typosquatting',
  'licenseViolation',
] as const;
const TIER_WEIGHTS = ['abandonment', 'unansweredIssues'] as const;
const WEIGHT_KEYS = [...NUMERIC_WEIGHTS, ...TIER_WEIGHTS, 'stalePublish', 'busFactor'];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkKeys(obj: Obj, allowed: readonly string[], where: string, source: string): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new ConfigError(
      `${source}: clave(s) desconocida(s) en ${where}: ${unknown.join(', ')}. Permitidas: ${allowed.join(', ')}.`,
    );
  }
}

function num(v: unknown, where: string, source: string, min: number, max: number, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    throw new ConfigError(`${source}: "${where}" debe ser un ${integer ? 'entero' : 'número'} entre ${min} y ${max}.`);
  }
  return v;
}

function bool(v: unknown, where: string, source: string): boolean {
  if (typeof v !== 'boolean') throw new ConfigError(`${source}: "${where}" debe ser true o false.`);
  return v;
}

function tier(v: unknown, where: string, source: string): Tier {
  if (!isObj(v)) throw new ConfigError(`${source}: "${where}" debe ser un objeto { "threshold", "points" }.`);
  checkKeys(v, ['threshold', 'points'], where, source);
  return {
    threshold: num(v.threshold, `${where}.threshold`, source, 0, 100_000),
    points: num(v.points, `${where}.points`, source, 0, 100),
  };
}

function tiers(v: unknown, where: string, source: string): Tier[] {
  if (!Array.isArray(v)) throw new ConfigError(`${source}: "${where}" debe ser un array de tramos.`);
  // El motor espera los tramos de mayor a menor umbral.
  return v.map((t, i) => tier(t, `${where}[${i}]`, source)).sort((a, b) => b.threshold - a.threshold);
}

function parseWeights(v: unknown, source: string): ScoringWeights {
  const w: ScoringWeights = {
    ...DEFAULT_WEIGHTS,
    busFactor: { ...DEFAULT_WEIGHTS.busFactor },
    stalePublish: { ...DEFAULT_WEIGHTS.stalePublish },
  };
  if (v === undefined) return w;
  if (!isObj(v)) throw new ConfigError(`${source}: "weights" debe ser un objeto.`);
  checkKeys(v, WEIGHT_KEYS, 'weights', source);

  for (const key of NUMERIC_WEIGHTS) {
    if (v[key] !== undefined) {
      const max = key === 'dormantRevivalDays' ? 100_000 : 100;
      w[key] = num(v[key], `weights.${key}`, source, 0, max);
    }
  }
  for (const key of TIER_WEIGHTS) {
    if (v[key] !== undefined) w[key] = tiers(v[key], `weights.${key}`, source);
  }
  if (v.stalePublish !== undefined) w.stalePublish = tier(v.stalePublish, 'weights.stalePublish', source);
  if (v.busFactor !== undefined) {
    if (!isObj(v.busFactor)) throw new ConfigError(`${source}: "weights.busFactor" debe ser un objeto.`);
    checkKeys(v.busFactor, ['zero', 'one', 'two'], 'weights.busFactor', source);
    for (const k of ['zero', 'one', 'two'] as const) {
      if (v.busFactor[k] !== undefined) w.busFactor[k] = num(v.busFactor[k], `weights.busFactor.${k}`, source, 0, 100);
    }
  }
  return w;
}

function parseThresholds(v: unknown, source: string): Thresholds {
  const t: Thresholds = { ...THRESHOLDS };
  if (v === undefined) return t;
  if (!isObj(v)) throw new ConfigError(`${source}: "thresholds" debe ser un objeto.`);
  checkKeys(v, ['healthy', 'caution'], 'thresholds', source);
  if (v.healthy !== undefined) t.healthy = num(v.healthy, 'thresholds.healthy', source, 0, 100);
  if (v.caution !== undefined) t.caution = num(v.caution, 'thresholds.caution', source, 0, 100);
  if (t.caution > t.healthy) {
    throw new ConfigError(`${source}: "thresholds.caution" (${t.caution}) no puede ser mayor que "healthy" (${t.healthy}).`);
  }
  return t;
}

/** Valida y normaliza un objeto de configuración ya parseado. */
export function parseConfig(raw: unknown, source: string): GhostDepsConfig {
  if (!isObj(raw)) throw new ConfigError(`${source}: la configuración debe ser un objeto JSON.`);
  checkKeys(raw, TOP_LEVEL_KEYS, 'la raíz', source);

  let ignore: string[] = [];
  if (raw.ignore !== undefined) {
    if (!Array.isArray(raw.ignore) || raw.ignore.some((p) => typeof p !== 'string' || p.trim() === '')) {
      throw new ConfigError(`${source}: "ignore" debe ser un array de nombres/patrones (ej. ["left-pad", "@types/*"]).`);
    }
    ignore = (raw.ignore as string[]).map((p) => p.trim());
  }

  const config: GhostDepsConfig = {
    source,
    ignore,
    weights: parseWeights(raw.weights, source),
    thresholds: parseThresholds(raw.thresholds, source),
  };
  if (raw.failUnder !== undefined) config.failUnder = num(raw.failUnder, 'failUnder', source, 0, 100);
  if (raw.dev !== undefined) config.dev = bool(raw.dev, 'dev', source);
  if (raw.transitive !== undefined) config.transitive = bool(raw.transitive, 'transitive', source);
  if (raw.depth !== undefined) config.depth = num(raw.depth, 'depth', source, 1, 100, true);
  if (raw.concurrency !== undefined) config.concurrency = num(raw.concurrency, 'concurrency', source, 1, 32, true);

  if (raw.allowedLicenses !== undefined) {
    if (!Array.isArray(raw.allowedLicenses) || raw.allowedLicenses.some((l) => typeof l !== 'string')) {
      throw new ConfigError(`${source}: "allowedLicenses" debe ser un array de licencias (ej. ["MIT", "Apache-2.0"]).`);
    }
    config.allowedLicenses = (raw.allowedLicenses as string[]).map((l) => l.trim());
  }
  if (raw.deniedLicenses !== undefined) {
    if (!Array.isArray(raw.deniedLicenses) || raw.deniedLicenses.some((l) => typeof l !== 'string')) {
      throw new ConfigError(`${source}: "deniedLicenses" debe ser un array de licencias (ej. ["GPL-3.0"]).`);
    }
    config.deniedLicenses = (raw.deniedLicenses as string[]).map((l) => l.trim());
  }
  if (raw.webhook !== undefined) {
    if (typeof raw.webhook !== 'string' || !raw.webhook.trim()) {
      throw new ConfigError(`${source}: "webhook" debe ser una URL válida.`);
    }
    config.webhook = raw.webhook.trim();
  }
  return config;
}

export function defaultConfig(): GhostDepsConfig {
  return { ...parseConfig({}, '(defaults)'), source: null };
}

async function readJson(file: string): Promise<unknown | undefined> {
  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ConfigError(`No se pudo leer ${file}: ${(err as Error).message}`, { cause: err });
  }
  try {
    return JSON.parse(content);
  } catch (cause) {
    throw new ConfigError(`${file} no es un JSON válido.`, { cause });
  }
}

export async function loadConfig(dir: string, explicitPath?: string): Promise<GhostDepsConfig> {
  if (explicitPath) {
    const file = path.resolve(explicitPath);
    const raw = await readJson(file);
    if (raw === undefined) throw new ConfigError(`No existe el archivo de configuración ${file}.`);
    return parseConfig(raw, file);
  }

  for (const name of CONFIG_FILES) {
    const file = path.resolve(dir, name);
    const raw = await readJson(file);
    if (raw !== undefined) return parseConfig(raw, file);
  }

  const pkgFile = path.resolve(dir, 'package.json');
  try {
    const pkg = await readJson(pkgFile);
    if (isObj(pkg) && pkg.ghostdeps !== undefined) return parseConfig(pkg.ghostdeps, `${pkgFile} ("ghostdeps")`);
  } catch {
    // Un package.json inválido lo reportará el lector de manifest con un mensaje más preciso.
  }
  return defaultConfig();
}

/** Convierte un patrón con `*` en RegExp anclada. */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Devuelve un predicado que indica si un paquete está ignorado (por nombre o patrón con `*`). */
export function createIgnoreMatcher(patterns: readonly string[]): (name: string) => boolean {
  const regexes = patterns.map(patternToRegExp);
  return (name) => regexes.some((r) => r.test(name));
}
