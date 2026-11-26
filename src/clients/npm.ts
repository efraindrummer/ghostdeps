import { normalizeRepository } from '../parser/repoUrl.js';
import type { InstallScript, InstallScriptSignal, MaintainerChange, NpmInfo } from '../types.js';
import type { DiskCache } from './cache.js';
import { fetchJson } from './http.js';

const REGISTRY = 'https://registry.npmjs.org';
/** Nº de versiones previas a la última que se usan para comparar publicadores. */
const PUBLISHER_HISTORY = 5;

const SUSPICIOUS_SCRIPT_REGEX = /\b(curl|wget|powershell|cmd\.exe|bash|sh)\b|https?:\/\/|eval\(|Buffer\.from\(|\bbase64\b|\/etc\/(passwd|shadow)|\.ssh\/|\.env\b/i;
const LIFECYCLE_STAGES = ['preinstall', 'install', 'postinstall'] as const;

export function inspectInstallScripts(scripts: Record<string, unknown> | undefined): InstallScriptSignal {
  if (!scripts || typeof scripts !== 'object') {
    return { hasInstallScripts: false, suspicious: false, scripts: [] };
  }
  const detected: InstallScript[] = [];
  let isSuspicious = false;

  for (const stage of LIFECYCLE_STAGES) {
    const cmd = scripts[stage];
    if (typeof cmd === 'string' && cmd.trim()) {
      const match = SUSPICIOUS_SCRIPT_REGEX.test(cmd);
      let reason: string | undefined;
      if (match) {
        isSuspicious = true;
        if (/curl|wget|https?:\/\//i.test(cmd)) reason = 'descarga de red en la instalación';
        else if (/powershell|cmd\.exe|bash|sh/i.test(cmd)) reason = 'ejecución de shell';
        else if (/eval\(|base64|Buffer\.from/i.test(cmd)) reason = 'posible ofuscación / eval';
        else reason = 'patrón sospechoso';
      }
      detected.push({ stage, command: cmd.trim(), suspicious: match, reason });
    }
  }

  return {
    hasInstallScripts: detected.length > 0,
    suspicious: isSuspicious,
    scripts: detected,
  };
}

interface NpmPerson {
  name?: string;
  email?: string;
}

interface NpmVersionDoc {
  version?: string;
  deprecated?: string | boolean;
  repository?: unknown;
  homepage?: string;
  maintainers?: NpmPerson[] | NpmPerson | string;
  _npmUser?: NpmPerson | string;
  scripts?: Record<string, unknown>;
  license?: unknown;
  dist?: {
    attestations?: unknown;
    signatures?: unknown[];
    tarball?: string;
  };
}

export interface NpmPackument {
  name?: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, NpmVersionDoc>;
  time?: Record<string, string>;
  maintainers?: NpmPerson[];
  repository?: unknown;
  homepage?: string;
  license?: unknown;
}

function personName(p: NpmPerson | string | undefined): string | null {
  if (!p) return null;
  if (typeof p === 'string') return p.replace(/\s*<.*$/, '').trim() || null;
  return p.name ?? p.email ?? null;
}

function personList(value: NpmVersionDoc['maintainers'] | undefined): string[] | null {
  if (value === undefined) return null;
  const arr = Array.isArray(value) ? value : [value];
  return [...new Set(arr.map(personName).filter((n): n is string => !!n))].sort();
}

function diffMaintainers(previous: string[], current: string[]): MaintainerChange {
  const prev = new Set(previous);
  const curr = new Set(current);
  return {
    added: current.filter((m) => !prev.has(m)),
    removed: previous.filter((m) => !curr.has(m)),
  };
}

export function registryUrl(name: string): string {
  const encoded = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  return `${REGISTRY}/${encoded}`;
}

/** Extracción pura (testeable) de la información relevante del "packument" de npm. */
export function extractNpmInfo(name: string, doc: NpmPackument): NpmInfo {
  const versions = doc.versions ?? {};
  const time = doc.time ?? {};

  // Versiones ordenadas cronológicamente por fecha de publicación.
  const chronological = Object.entries(time)
    .filter(([v]) => v !== 'created' && v !== 'modified' && versions[v] !== undefined)
    .sort(([, a], [, b]) => Date.parse(a) - Date.parse(b))
    .map(([v]) => v);

  const latestTag = doc['dist-tags']?.latest;
  const latestVersion =
    latestTag && versions[latestTag] ? latestTag : (chronological[chronological.length - 1] ?? null);
  const latestDoc = latestVersion ? versions[latestVersion] : undefined;
  const latestPublishedAt = latestVersion ? (time[latestVersion] ?? null) : null;

  // Versiones publicadas antes que la "latest" (excluye versiones posteriores, p. ej. backports).
  const latestTime = latestPublishedAt ? Date.parse(latestPublishedAt) : Number.POSITIVE_INFINITY;
  const previous = chronological.filter(
    (v) => v !== latestVersion && Date.parse(time[v] ?? '') < latestTime,
  );
  const previousVersion = previous[previous.length - 1] ?? null;
  const previousDoc = previousVersion ? versions[previousVersion] : undefined;

  const latestPublisher = personName(latestDoc?._npmUser);
  const previousPublishers = [
    ...new Set(
      previous
        .slice(-PUBLISHER_HISTORY)
        .map((v) => personName(versions[v]?._npmUser))
        .filter((n): n is string => !!n),
    ),
  ];

  const latestMaintainers = personList(latestDoc?.maintainers);
  const previousMaintainers = personList(previousDoc?.maintainers);
  const maintainersChange =
    latestMaintainers && previousMaintainers ? diffMaintainers(previousMaintainers, latestMaintainers) : null;

  // Repo: preferimos el de la última versión; si falta, el del documento; si falta, homepage.
  const repoField = latestDoc?.repository ?? doc.repository;
  let repository = normalizeRepository(repoField);
  if (!repository) {
    const homepage = latestDoc?.homepage ?? doc.homepage;
    const fromHomepage = homepage ? normalizeRepository(homepage) : null;
    if (fromHomepage && fromHomepage.host === 'github') repository = fromHomepage;
  }
  let rawRepositoryUrl: string | null = null;
  if (typeof repoField === 'string') rawRepositoryUrl = repoField;
  else if (repoField && typeof repoField === 'object') {
    const url = (repoField as Record<string, unknown>).url;
    if (typeof url === 'string') rawRepositoryUrl = url;
  }

  const deprecatedRaw = latestDoc?.deprecated;
  const deprecated =
    typeof deprecatedRaw === 'string' && deprecatedRaw.length > 0
      ? deprecatedRaw
      : deprecatedRaw === true
        ? 'deprecated'
        : null;

  let license: string | null = null;
  const rawLic = latestDoc?.license ?? doc.license;
  if (typeof rawLic === 'string' && rawLic.trim()) {
    license = rawLic.trim();
  } else if (rawLic && typeof rawLic === 'object' && 'type' in rawLic) {
    const t = (rawLic as { type?: unknown }).type;
    if (typeof t === 'string' && t.trim()) license = t.trim();
  }

  const hasProvenance = Boolean(
    latestDoc?.dist?.attestations ||
      (Array.isArray(latestDoc?.dist?.signatures) && latestDoc.dist.signatures.length > 0),
  );

  return {
    name: doc.name ?? name,
    latestVersion,
    latestPublishedAt,
    previousPublishedAt: previousVersion ? (time[previousVersion] ?? null) : null,
    deprecated,
    maintainers: personList(doc.maintainers) ?? [],
    repository,
    rawRepositoryUrl,
    latestPublisher,
    previousPublishers,
    maintainersChange,
    installScripts: inspectInstallScripts(latestDoc?.scripts as Record<string, unknown> | undefined),
    hasProvenance,
    license,
  };
}

export interface NpmClientOptions {
  cache: DiskCache;
  timeoutMs: number;
  retries: number;
  userAgent: string;
}

export class NpmClient {
  constructor(private readonly opts: NpmClientOptions) {}

  async getPackageInfo(name: string): Promise<NpmInfo> {
    const key = `npm:${name}`;
    const cached = await this.opts.cache.get<NpmInfo>(key);
    if (cached) return cached;

    const { data } = await fetchJson<NpmPackument>(registryUrl(name), {
      timeoutMs: this.opts.timeoutMs,
      retries: this.opts.retries,
      headers: { accept: 'application/json', 'user-agent': this.opts.userAgent },
    });
    const info = extractNpmInfo(name, data);
    await this.opts.cache.set(key, info);
    return info;
  }
}
