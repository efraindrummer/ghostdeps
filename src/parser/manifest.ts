import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ManifestError } from '../errors.js';
import type { DependencyKind, DependencySpec } from '../types.js';

export interface ManifestOptions {
  includeDev: boolean;
}

export interface ParsedManifest {
  manifestPath: string;
  projectName: string | null;
  dependencies: DependencySpec[];
}

/** Especificadores que no apuntan al registry de npm y por tanto no se evalúan. */
const NON_REGISTRY_PREFIXES: ReadonlyArray<[prefix: string, reason: string]> = [
  ['file:', 'Dependencia local (file:)'],
  ['link:', 'Dependencia local (link:)'],
  ['portal:', 'Dependencia local (portal:)'],
  ['workspace:', 'Paquete del workspace (workspace:)'],
  ['git+', 'Dependencia instalada desde git'],
  ['git:', 'Dependencia instalada desde git'],
  ['git@', 'Dependencia instalada desde git'],
  ['http:', 'Dependencia instalada desde una URL (tarball)'],
  ['https:', 'Dependencia instalada desde una URL (tarball)'],
  ['github:', 'Dependencia instalada directamente desde GitHub'],
  ['gitlab:', 'Dependencia instalada directamente desde GitLab'],
  ['bitbucket:', 'Dependencia instalada directamente desde Bitbucket'],
];

export function classifySpec(name: string, spec: string, kind: DependencyKind): DependencySpec {
  const trimmed = spec.trim();
  const base: DependencySpec = { name, registryName: name, spec: trimmed, kind, depth: 1, via: [] };

  // Alias: "foo": "npm:bar@^1.0.0" -> se evalúa "bar".
  if (trimmed.startsWith('npm:')) {
    const rest = trimmed.slice(4);
    const at = rest.lastIndexOf('@');
    return { ...base, registryName: at > 0 ? rest.slice(0, at) : rest };
  }

  for (const [prefix, reason] of NON_REGISTRY_PREFIXES) {
    if (trimmed.startsWith(prefix)) return { ...base, unsupportedReason: reason };
  }

  // Shorthand de GitHub como especificador: "usuario/repo" o "usuario/repo#rama".
  // Un rango semver o un dist-tag nunca contienen "/".
  if (trimmed.includes('/')) {
    return { ...base, unsupportedReason: 'Dependencia instalada directamente desde GitHub (shorthand)' };
  }

  return base;
}

function readDependencyBlock(
  manifest: Record<string, unknown>,
  kind: DependencyKind,
  manifestPath: string,
): DependencySpec[] {
  const block = manifest[kind];
  if (block === undefined || block === null) return [];
  if (typeof block !== 'object' || Array.isArray(block)) {
    throw new ManifestError(`El campo "${kind}" de ${manifestPath} debe ser un objeto.`);
  }
  return Object.entries(block as Record<string, unknown>).map(([name, spec]) => {
    if (typeof spec !== 'string') {
      throw new ManifestError(`La versión de "${name}" en "${kind}" debe ser un string.`);
    }
    return classifySpec(name, spec, kind);
  });
}

export function parseManifestContent(
  content: string,
  manifestPath: string,
  options: ManifestOptions,
): ParsedManifest {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (cause) {
    throw new ManifestError(`${manifestPath} no es un JSON válido.`, { cause });
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ManifestError(`${manifestPath} debe contener un objeto JSON.`);
  }
  const manifest = json as Record<string, unknown>;

  const deps = readDependencyBlock(manifest, 'dependencies', manifestPath);
  if (options.includeDev) {
    const seen = new Set(deps.map((d) => d.name));
    for (const dev of readDependencyBlock(manifest, 'devDependencies', manifestPath)) {
      // Si está en ambos bloques, prevalece `dependencies`.
      if (!seen.has(dev.name)) deps.push(dev);
    }
  }

  return {
    manifestPath,
    projectName: typeof manifest.name === 'string' ? manifest.name : null,
    dependencies: deps,
  };
}

export async function readManifest(dir: string, options: ManifestOptions): Promise<ParsedManifest> {
  const manifestPath = path.resolve(dir, 'package.json');
  let content: string;
  try {
    content = await readFile(manifestPath, 'utf8');
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ManifestError(`No se encontró package.json en ${path.resolve(dir)}. Usa --path <dir>.`);
    }
    throw new ManifestError(`No se pudo leer ${manifestPath}: ${(cause as Error).message}`, { cause });
  }
  return parseManifestContent(content, manifestPath, options);
}
