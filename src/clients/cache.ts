import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Incrementar cuando cambie la forma de los datos cacheados. */
const CACHE_SCHEMA = 'v1';

interface CacheEntry<T> {
  storedAt: number;
  value: T;
}

export function defaultCacheDir(): string {
  const env = process.env;
  if (env.GHOSTDEPS_CACHE_DIR) return env.GHOSTDEPS_CACHE_DIR;
  if (env.XDG_CACHE_HOME) return path.join(env.XDG_CACHE_HOME, 'ghostdeps');
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'ghostdeps', 'cache');
  }
  return path.join(os.homedir(), '.cache', 'ghostdeps');
}

/**
 * Caché clave/valor en disco con TTL. Guarda datos ya extraídos (no las respuestas crudas)
 * para mantener los archivos pequeños. Cualquier fallo de lectura/escritura se ignora:
 * la caché nunca debe romper un análisis.
 */
export class DiskCache {
  constructor(
    private readonly dir: string,
    private readonly ttlMs: number,
    private readonly enabled = true,
  ) {}

  private fileFor(key: string): string {
    const hash = createHash('sha256').update(`${CACHE_SCHEMA}:${key}`).digest('hex');
    return path.join(this.dir, `${hash}.json`);
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.enabled) return undefined;
    try {
      const raw = await readFile(this.fileFor(key), 'utf8');
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (typeof entry.storedAt !== 'number' || Date.now() - entry.storedAt > this.ttlMs) return undefined;
      return entry.value;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (!this.enabled) return;
    try {
      await mkdir(this.dir, { recursive: true });
      const file = this.fileFor(key);
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      const entry: CacheEntry<T> = { storedAt: Date.now(), value };
      await writeFile(tmp, JSON.stringify(entry), 'utf8');
      await rename(tmp, file); // escritura atómica
    } catch {
      // Ignorado a propósito.
    }
  }
}
