import type { RepoHost, RepoRef } from '../types.js';

const SHORTHAND_PROVIDER = /^(github|gitlab|bitbucket):([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:#.*)?$/i;
/** "owner/repo" sin protocolo: el registry lo interpreta como GitHub. */
const BARE_SHORTHAND = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:#.*)?$/;
/** Sintaxis tipo scp: git@github.com:owner/repo.git */
const SCP_LIKE = /^(?:[\w.-]+@)?([\w.-]+\.[a-z]{2,}):(?!\/\/)\/?([^/]+)\/(.+)$/i;

const PROVIDER_HOSTNAMES: Record<string, string> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
};

function hostFromHostname(hostname: string): RepoHost {
  if (hostname === 'github.com') return 'github';
  if (hostname === 'gitlab.com') return 'gitlab';
  if (hostname === 'bitbucket.org') return 'bitbucket';
  return 'other';
}

function cleanDirectory(dir: string | undefined): string | undefined {
  if (!dir) return undefined;
  const cleaned = dir.trim().replace(/^\.?\/+/, '').replace(/\/+$/, '');
  return cleaned.length > 0 ? cleaned : undefined;
}

function cleanRepoName(repo: string): string {
  return repo.replace(/\.git$/i, '').replace(/#.*$/, '');
}

function build(hostname: string, owner: string, repo: string, directory?: string): RepoRef | null {
  const name = cleanRepoName(repo);
  if (!owner || !name) return null;
  const host = hostFromHostname(hostname);
  const ref: RepoRef = { host, hostname, owner, repo: name, url: `https://${hostname}/${owner}/${name}` };
  const dir = cleanDirectory(directory);
  if (dir) ref.directory = dir;
  return ref;
}

/**
 * Normaliza el campo `repository` de npm (string u objeto {type,url,directory}) a un RepoRef.
 * Soporta: git+https, git://, git+ssh://, ssh scp-like (git@host:o/r), https con /tree/<rama>/<dir>,
 * shorthand `github:o/r`, `gitlab:o/r`, `bitbucket:o/r` y `o/r`.
 */
export function normalizeRepository(input: unknown): RepoRef | null {
  let raw: string | undefined;
  let directory: string | undefined;

  if (typeof input === 'string') {
    raw = input;
  } else if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (typeof obj.url === 'string') raw = obj.url;
    if (typeof obj.directory === 'string') directory = obj.directory;
  }
  if (!raw) return null;
  raw = raw.trim();
  if (!raw) return null;

  const provider = SHORTHAND_PROVIDER.exec(raw);
  if (provider) {
    const [, kind, owner, repo] = provider;
    const hostname = PROVIDER_HOSTNAMES[(kind ?? '').toLowerCase()];
    return hostname && owner && repo ? build(hostname, owner, repo, directory) : null;
  }

  const bare = BARE_SHORTHAND.exec(raw);
  if (bare && !raw.includes(':')) {
    const [, owner, repo] = bare;
    return owner && repo ? build('github.com', owner, repo, directory) : null;
  }

  const scp = SCP_LIKE.exec(raw);
  if (scp) {
    const [, hostname, owner, rest] = scp;
    if (!hostname || !owner || !rest) return null;
    const repo = rest.split('/')[0] ?? '';
    return build(hostname.toLowerCase().replace(/^www\./, ''), owner, repo, directory);
  }

  let urlString = raw.replace(/^git\+/, '');
  urlString = urlString.replace(/^git:\/\//, 'https://').replace(/^ssh:\/\//, 'https://');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(urlString)) urlString = `https://${urlString}`;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean);
  const [owner, repo, kind, , ...dirParts] = segments;
  if (!owner || !repo) return null;

  // https://github.com/o/r/tree/main/packages/x  -> directory = packages/x
  if (!directory && (kind === 'tree' || kind === 'blob') && dirParts.length > 0) {
    directory = dirParts.join('/');
  }
  return build(hostname, owner, repo, directory);
}
