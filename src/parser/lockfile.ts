/**
 * Resolución de dependencias transitivas a partir de lockfiles:
 *  - package-lock.json / npm-shrinkwrap.json (npm v2/v3, npm >= 7)
 *  - yarn.lock (Yarn v1 clásico)
 *
 * Recorre el grafo en anchura (BFS) para registrar el camino más corto
 * desde el proyecto (`via`) y la profundidad de cada dependencia.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ManifestError } from '../errors.js';
import type { DependencySpec } from '../types.js';

export interface LockPackage {
  name?: string;
  version?: string;
  resolved?: string;
  link?: boolean;
  dev?: boolean;
  optional?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface NpmLockfile {
  type: 'npm';
  lockfileVersion?: number;
  packages?: Record<string, LockPackage>;
}

export interface YarnPackage {
  name: string;
  version: string;
  resolved?: string;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
}

export interface YarnLockfile {
  type: 'yarn';
  entries: Map<string, YarnPackage>;
}

export interface PnpmPackage {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
}

export interface PnpmLockfile {
  type: 'pnpm';
  packages: Map<string, PnpmPackage>;
}

export type AnyLockfile = NpmLockfile | YarnLockfile | PnpmLockfile;

export interface TransitiveOptions {
  /** Profundidad máxima (1 = solo directas). */
  maxDepth: number;
}

export const LOCKFILE_NAMES = ['npm-shrinkwrap.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'] as const;

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Parser ligero y seguro para yarn.lock (v1).
 * Mapea especificaciones (`foo@^1.0.0`) a la versión resuelta y sus dependencias.
 */
export function parseYarnLock(content: string): YarnLockfile {
  const entries = new Map<string, YarnPackage>();
  const lines = content.split(/\r?\n/);
  let currentHeaders: string[] = [];
  let currentPkg: Partial<YarnPackage> | null = null;
  let section: 'none' | 'dependencies' | 'optionalDependencies' = 'none';

  const flush = () => {
    if (currentHeaders.length > 0 && currentPkg && currentPkg.name && currentPkg.version) {
      const pkg: YarnPackage = {
        name: currentPkg.name,
        version: currentPkg.version,
        resolved: currentPkg.resolved,
        dependencies: currentPkg.dependencies ?? {},
        optionalDependencies: currentPkg.optionalDependencies ?? {},
      };
      for (const h of currentHeaders) {
        entries.set(h, pkg);
      }
    }
    currentHeaders = [];
    currentPkg = null;
    section = 'none';
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    // Header de nivel superior (ej. "foo@^1.0.0", "foo@^1.2.0":)
    if (!rawLine.startsWith(' ') && trimmed.endsWith(':')) {
      flush();
      const headerStr = trimmed.slice(0, -1);
      const parts = headerStr.split(',').map((p) => unquote(p));
      currentHeaders = parts;
      const first = parts[0] ?? '';
      const at = first.lastIndexOf('@');
      const name = at > 0 ? first.slice(0, at) : first;
      currentPkg = { name, dependencies: {}, optionalDependencies: {} };
      continue;
    }

    if (!currentPkg) continue;

    // Propiedades directas (2 espacios de indentación)
    if (rawLine.startsWith('  ') && !rawLine.startsWith('    ')) {
      section = 'none';
      if (trimmed.startsWith('version ')) {
        currentPkg.version = unquote(trimmed.slice(8));
      } else if (trimmed.startsWith('resolved ')) {
        currentPkg.resolved = unquote(trimmed.slice(9));
      } else if (trimmed === 'dependencies:') {
        section = 'dependencies';
      } else if (trimmed === 'optionalDependencies:') {
        section = 'optionalDependencies';
      }
      continue;
    }

    // Sub-claves de dependencias (4 espacios de indentación)
    if (rawLine.startsWith('    ') && (section === 'dependencies' || section === 'optionalDependencies')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const depName = unquote(parts[0] ?? '');
        const depSpec = unquote(parts.slice(1).join(' '));
        if (section === 'dependencies') {
          currentPkg.dependencies![depName] = depSpec;
        } else {
          currentPkg.optionalDependencies![depName] = depSpec;
        }
      }
    }
  }

  flush();
  return { type: 'yarn', entries };
}

/**
 * Parser ligero y seguro para pnpm-lock.yaml (v5/v6/v9).
 */
export function parsePnpmLock(content: string): PnpmLockfile {
  const packages = new Map<string, PnpmPackage>();
  const lines = content.split(/\r?\n/);
  let inPackages = false;
  let currentKey: string | null = null;
  let currentPkg: Partial<PnpmPackage> | null = null;
  let subSection: 'none' | 'dependencies' | 'optionalDependencies' = 'none';

  const flush = () => {
    if (currentKey && currentPkg && currentPkg.name && currentPkg.version) {
      packages.set(currentKey, {
        name: currentPkg.name,
        version: currentPkg.version,
        dependencies: currentPkg.dependencies ?? {},
        optionalDependencies: currentPkg.optionalDependencies ?? {},
      });
    }
    currentKey = null;
    currentPkg = null;
    subSection = 'none';
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (rawLine.startsWith('packages:')) {
      inPackages = true;
      continue;
    }

    if (!inPackages) continue;

    if (!rawLine.startsWith(' ') && trimmed.endsWith(':')) {
      flush();
      inPackages = false;
      continue;
    }

    if (rawLine.startsWith('  ') && !rawLine.startsWith('    ') && trimmed.endsWith(':')) {
      flush();
      let key = trimmed.slice(0, -1).trim();
      key = unquote(key).replace(/^\//, '').replace(/\(.*$/, '');
      const lastAt = key.lastIndexOf('@');
      if (lastAt > 0) {
        const name = key.slice(0, lastAt);
        const version = key.slice(lastAt + 1);
        currentKey = `${name}@${version}`;
        currentPkg = { name, version, dependencies: {}, optionalDependencies: {} };
      }
      continue;
    }

    if (!currentPkg) continue;

    if (rawLine.startsWith('    ') && !rawLine.startsWith('      ')) {
      if (trimmed === 'dependencies:') {
        subSection = 'dependencies';
      } else if (trimmed === 'optionalDependencies:') {
        subSection = 'optionalDependencies';
      } else {
        subSection = 'none';
      }
      continue;
    }

    if (rawLine.startsWith('      ') && (subSection === 'dependencies' || subSection === 'optionalDependencies')) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const depName = unquote(trimmed.slice(0, colonIdx));
        const depVersion = unquote(trimmed.slice(colonIdx + 1));
        if (subSection === 'dependencies') {
          currentPkg.dependencies![depName] = depVersion;
        } else {
          currentPkg.optionalDependencies![depName] = depVersion;
        }
      }
    }
  }

  flush();
  return { type: 'pnpm', packages };
}

export async function readLockfile(dir: string): Promise<{ file: string; lock: AnyLockfile }> {
  for (const name of LOCKFILE_NAMES) {
    const file = path.resolve(dir, name);
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new ManifestError(`No se pudo leer ${file}: ${(err as Error).message}`, { cause: err });
    }

    if (name === 'yarn.lock') {
      try {
        const lock = parseYarnLock(content);
        return { file, lock };
      } catch (cause) {
        throw new ManifestError(`Error al procesar ${file}: ${(cause as Error).message}`, { cause });
      }
    }

    if (name === 'pnpm-lock.yaml') {
      try {
        const lock = parsePnpmLock(content);
        return { file, lock };
      } catch (cause) {
        throw new ManifestError(`Error al procesar ${file}: ${(cause as Error).message}`, { cause });
      }
    }

    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const lock: NpmLockfile = {
        type: 'npm',
        lockfileVersion: typeof parsed.lockfileVersion === 'number' ? parsed.lockfileVersion : undefined,
        packages: typeof parsed.packages === 'object' && parsed.packages !== null ? (parsed.packages as Record<string, LockPackage>) : undefined,
      };
      return { file, lock };
    } catch (cause) {
      throw new ManifestError(`${file} no es un JSON válido.`, { cause });
    }
  }

  throw new ManifestError(
    `--transitive requiere package-lock.json, yarn.lock o pnpm-lock.yaml en ${path.resolve(dir)}. ` +
      'Ejecuta "npm install", "yarn install" o "pnpm install".',
  );
}

/**
 * Resolución estilo Node para npm: busca `<from>/node_modules/<name>` y sube por los ancestros.
 */
export function resolvePackageKey(
  packages: Record<string, LockPackage>,
  name: string,
  fromKey: string,
): string | null {
  let base = fromKey;
  while (true) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const idx = base.lastIndexOf('/node_modules/');
    base = idx >= 0 ? base.slice(0, idx) : '';
  }
}

function unsupportedReasonFromUrl(resolved: string | undefined): string | undefined {
  if (!resolved) return undefined;
  if (resolved.startsWith('file:')) return 'Dependencia local (file:)';
  if (/^git(\+|:|@)/.test(resolved)) return 'Dependencia instalada desde git';
  return undefined;
}

function resolveNpmTransitive(
  lock: NpmLockfile,
  direct: readonly DependencySpec[],
  options: TransitiveOptions,
): DependencySpec[] {
  if (!lock.packages) {
    throw new ManifestError(
      `lockfileVersion ${lock.lockfileVersion ?? '?'} no soportado para --transitive: regenera el lockfile con npm >= 7.`,
    );
  }
  const packages = lock.packages;
  const directNames = new Set(direct.map((d) => d.name));
  const seenNames = new Set<string>(directNames);
  const visitedKeys = new Set<string>();
  const result: DependencySpec[] = [];

  interface Node {
    key: string;
    depth: number;
    via: string[];
  }
  const queue: Node[] = [];

  for (const d of direct) {
    if (d.unsupportedReason) continue;
    const key = resolvePackageKey(packages, d.name, '');
    if (!key || visitedKeys.has(key)) continue;
    visitedKeys.add(key);
    queue.push({ key, depth: 1, via: [d.name] });
  }

  while (queue.length > 0) {
    const node = queue.shift() as Node;
    if (node.depth >= options.maxDepth) continue;
    const entry = packages[node.key];
    if (!entry || entry.link) continue;

    const children = { ...entry.dependencies, ...entry.optionalDependencies };
    for (const childName of Object.keys(children).sort()) {
      const childKey = resolvePackageKey(packages, childName, node.key);
      if (!childKey || visitedKeys.has(childKey)) continue;
      visitedKeys.add(childKey);
      const child = packages[childKey] as LockPackage;
      const depth = node.depth + 1;

      if (!seenNames.has(childName) && !child.link) {
        seenNames.add(childName);
        const spec: DependencySpec = {
          name: childName,
          registryName: child.name ?? childName,
          spec: child.version ?? '?',
          kind: 'transitive',
          depth,
          via: node.via,
        };
        const reason = unsupportedReasonFromUrl(child.resolved);
        if (reason) spec.unsupportedReason = reason;
        result.push(spec);
      }
      queue.push({ key: childKey, depth, via: [...node.via, childName] });
    }
  }
  return result;
}

function resolveYarnTransitive(
  lock: YarnLockfile,
  direct: readonly DependencySpec[],
  options: TransitiveOptions,
): DependencySpec[] {
  const entries = lock.entries;
  const directNames = new Set(direct.map((d) => d.name));
  const seenNames = new Set<string>(directNames);
  const visited = new Set<string>();
  const result: DependencySpec[] = [];

  const findEntry = (name: string, spec?: string): YarnPackage | undefined => {
    if (spec) {
      const directKey = `${name}@${spec}`;
      if (entries.has(directKey)) return entries.get(directKey);
    }
    const prefix = `${name}@`;
    for (const [k, v] of entries) {
      if (k.startsWith(prefix)) return v;
    }
    return undefined;
  };

  interface Node {
    name: string;
    pkg: YarnPackage;
    depth: number;
    via: string[];
  }
  const queue: Node[] = [];

  for (const d of direct) {
    if (d.unsupportedReason) continue;
    const pkg = findEntry(d.name, d.spec);
    if (!pkg) continue;
    const visitKey = `${d.name}@${pkg.version}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    queue.push({ name: d.name, pkg, depth: 1, via: [d.name] });
  }

  while (queue.length > 0) {
    const node = queue.shift() as Node;
    if (node.depth >= options.maxDepth) continue;

    const children = { ...node.pkg.dependencies, ...node.pkg.optionalDependencies };
    for (const [childName, childSpec] of Object.entries(children).sort(([a], [b]) => a.localeCompare(b))) {
      const childPkg = findEntry(childName, childSpec);
      if (!childPkg) continue;
      const visitKey = `${childName}@${childPkg.version}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      const depth = node.depth + 1;
      if (!seenNames.has(childName)) {
        seenNames.add(childName);
        const spec: DependencySpec = {
          name: childName,
          registryName: childPkg.name,
          spec: childPkg.version,
          kind: 'transitive',
          depth,
          via: node.via,
        };
        const reason = unsupportedReasonFromUrl(childPkg.resolved);
        if (reason) spec.unsupportedReason = reason;
        result.push(spec);
      }
      queue.push({ name: childName, pkg: childPkg, depth, via: [...node.via, childName] });
    }
  }

  return result;
}

function resolvePnpmTransitive(
  lock: PnpmLockfile,
  direct: readonly DependencySpec[],
  options: TransitiveOptions,
): DependencySpec[] {
  const packages = lock.packages;
  const directNames = new Set(direct.map((d) => d.name));
  const seenNames = new Set<string>(directNames);
  const visited = new Set<string>();
  const result: DependencySpec[] = [];

  const findEntry = (name: string, spec?: string): PnpmPackage | undefined => {
    if (spec) {
      const cleanSpec = spec.replace(/\(.*$/, '');
      const exactKey = `${name}@${cleanSpec}`;
      if (packages.has(exactKey)) return packages.get(exactKey);
      if (packages.has(spec)) return packages.get(spec);
    }
    const prefix = `${name}@`;
    for (const [k, v] of packages) {
      if (k.startsWith(prefix)) return v;
    }
    return undefined;
  };

  interface Node {
    name: string;
    pkg: PnpmPackage;
    depth: number;
    via: string[];
  }
  const queue: Node[] = [];

  for (const d of direct) {
    if (d.unsupportedReason) continue;
    const pkg = findEntry(d.name, d.spec);
    if (!pkg) continue;
    const visitKey = `${d.name}@${pkg.version}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    queue.push({ name: d.name, pkg, depth: 1, via: [d.name] });
  }

  while (queue.length > 0) {
    const node = queue.shift() as Node;
    if (node.depth >= options.maxDepth) continue;

    const children = { ...node.pkg.dependencies, ...node.pkg.optionalDependencies };
    for (const [childName, childSpec] of Object.entries(children).sort(([a], [b]) => a.localeCompare(b))) {
      const childPkg = findEntry(childName, childSpec);
      if (!childPkg) continue;
      const visitKey = `${childName}@${childPkg.version}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      const depth = node.depth + 1;
      if (!seenNames.has(childName)) {
        seenNames.add(childName);
        const spec: DependencySpec = {
          name: childName,
          registryName: childPkg.name,
          spec: childPkg.version,
          kind: 'transitive',
          depth,
          via: node.via,
        };
        result.push(spec);
      }
      queue.push({ name: childName, pkg: childPkg, depth, via: [...node.via, childName] });
    }
  }

  return result;
}

/**
 * Devuelve SOLO las dependencias transitivas (profundidad >= 2), deduplicadas por nombre,
 * alcanzables desde las directas indicadas en un lockfile de npm, Yarn o pnpm.
 */
export function resolveTransitive(
  lock: AnyLockfile,
  direct: readonly DependencySpec[],
  options: TransitiveOptions,
): DependencySpec[] {
  if (lock.type === 'yarn') {
    return resolveYarnTransitive(lock, direct, options);
  }
  if (lock.type === 'pnpm') {
    return resolvePnpmTransitive(lock, direct, options);
  }
  return resolveNpmTransitive(lock, direct, options);
}
