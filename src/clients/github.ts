import { NotFoundError, HttpError } from '../errors.js';
import type { GitHubInfo } from '../types.js';
import { isoDaysAgo } from '../utils.js';
import type { DiskCache } from './cache.js';
import { fetchJson, type HttpOptions, type RateLimitGate } from './http.js';

const API = 'https://api.github.com';

/** Ventana para "mantenedores activos" (autores únicos de commits). */
export const ACTIVE_WINDOW_DAYS = 365;
/** Antigüedad mínima de un issue abierto sin comentarios para contarlo como "sin respuesta". */
export const UNANSWERED_ISSUE_MIN_AGE_DAYS = 30;
/** Tope de páginas (x100 commits) al contar autores, para acotar el consumo de rate limit. */
const MAX_COMMIT_PAGES = 3;
const PER_PAGE = 100;

const BOT_LOGIN = /\[bot\]$|^(dependabot|renovate|greenkeeper|github-actions|snyk-bot|semantic-release-bot)/i;

interface GhRepo {
  full_name: string;
  archived: boolean;
  default_branch: string;
  has_issues: boolean;
}

interface GhCommit {
  author: { login?: string; type?: string } | null;
  commit: {
    author: { name?: string; email?: string; date?: string } | null;
    committer: { date?: string } | null;
  };
}

interface GhIssue {
  comments: number;
  created_at: string;
  pull_request?: unknown;
}

export interface GitHubClientOptions {
  cache: DiskCache;
  token?: string;
  timeoutMs: number;
  retries: number;
  userAgent: string;
  gate: RateLimitGate;
  maxRateLimitWaitMs: number;
  onRateLimitWait?: (ms: number, resetAt: Date) => void;
  now?: () => Date;
}

/** Identidad única de un autor de commit; null si es un bot. */
export function commitAuthorKey(c: GhCommit): string | null {
  const login = c.author?.login;
  if (login) {
    if (c.author?.type === 'Bot' || BOT_LOGIN.test(login)) return null;
    return `login:${login.toLowerCase()}`;
  }
  const name = c.commit.author?.name ?? '';
  if (BOT_LOGIN.test(name)) return null;
  const email = c.commit.author?.email?.toLowerCase();
  if (email) return `email:${email}`;
  return name ? `name:${name.toLowerCase()}` : null;
}

export class GitHubClient {
  private readonly http: HttpOptions;
  private readonly now: () => Date;

  constructor(private readonly opts: GitHubClientOptions) {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': opts.userAgent,
    };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    this.http = {
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      headers,
      rateLimit: { gate: opts.gate, maxWaitMs: opts.maxRateLimitWaitMs, onWait: opts.onRateLimitWait },
    };
    this.now = opts.now ?? (() => new Date());
  }

  private get<T>(pathAndQuery: string) {
    return fetchJson<T>(`${API}${pathAndQuery}`, this.http);
  }

  async getRepoHealth(owner: string, repo: string, directory?: string): Promise<GitHubInfo> {
    const requestedFullName = `${owner}/${repo}`;
    const key = `gh:${requestedFullName.toLowerCase()}:${directory ?? ''}`;
    const cached = await this.opts.cache.get<GitHubInfo>(key);
    if (cached) return cached;

    const repoRes = await this.get<GhRepo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    const meta = repoRes.data;
    // fetch sigue el 301 automáticamente; lo detectamos comparando el full_name final.
    const redirected = meta.full_name.toLowerCase() !== requestedFullName.toLowerCase();
    const base = `/repos/${meta.full_name}`;
    const now = this.now();

    const [commitStats, issues] = await Promise.all([
      this.commitStats(base, meta.default_branch, directory, now),
      meta.has_issues ? this.unansweredIssues(base, now) : Promise.resolve(null),
    ]);

    const info: GitHubInfo = {
      requestedFullName,
      fullName: meta.full_name,
      redirected,
      archived: meta.archived,
      defaultBranch: meta.default_branch,
      lastCommitAt: commitStats.lastCommitAt,
      activeMaintainers: commitStats.activeMaintainers,
      activeMaintainersCapped: commitStats.capped,
      unansweredIssues: issues?.count ?? null,
      unansweredIssuesCapped: issues?.capped ?? false,
      scopedToDirectory: commitStats.scopedToDirectory,
    };
    await this.opts.cache.set(key, info);
    return info;
  }

  /**
   * Una sola paginación de commits (rama por defecto, últimos 12 meses) sirve para:
   *  - autores únicos (mantenedores activos)
   *  - fecha del último commit (primer elemento, orden descendente)
   * Solo si no hay commits recientes se hace una petición extra para el último commit histórico.
   * En monorepos se filtra por `path=<directory>`; si el filtro no devuelve nada se cae al repo entero.
   */
  private async commitStats(base: string, branch: string, directory: string | undefined, now: Date) {
    const run = async (dir: string | undefined) => {
      const since = isoDaysAgo(ACTIVE_WINDOW_DAYS, now);
      const pathParam = dir ? `&path=${encodeURIComponent(dir)}` : '';
      const authors = new Set<string>();
      let lastCommitAt: string | null = null;
      let capped = false;

      for (let page = 1; page <= MAX_COMMIT_PAGES; page++) {
        const commits = await this.safeCommits(
          `${base}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(since)}&per_page=${PER_PAGE}&page=${page}${pathParam}`,
        );
        if (page === 1 && commits[0]) lastCommitAt = commits[0].commit.committer?.date ?? null;
        for (const c of commits) {
          const k = commitAuthorKey(c);
          if (k) authors.add(k);
        }
        if (commits.length < PER_PAGE) break;
        if (page === MAX_COMMIT_PAGES) capped = true;
      }

      if (!lastCommitAt) {
        const latest = await this.safeCommits(
          `${base}/commits?sha=${encodeURIComponent(branch)}&per_page=1${pathParam}`,
        );
        lastCommitAt = latest[0]?.commit.committer?.date ?? null;
      }
      return { lastCommitAt, activeMaintainers: authors.size, capped };
    };

    if (directory) {
      const scoped = await run(directory);
      if (scoped.lastCommitAt) return { ...scoped, scopedToDirectory: directory };
    }
    return { ...(await run(undefined)), scopedToDirectory: null };
  }

  /** Repos vacíos devuelven 409: lo tratamos como "sin commits". */
  private async safeCommits(pathAndQuery: string): Promise<GhCommit[]> {
    try {
      return (await this.get<GhCommit[]>(pathAndQuery)).data;
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) return [];
      if (err instanceof NotFoundError) return [];
      throw err;
    }
  }

  /**
   * Issues abiertos hace más de 30 días y con 0 comentarios. Se piden los 100 más antiguos
   * (orden ascendente), que son justamente los candidatos; si hay más de 100 abiertos el
   * resultado se marca como "capped" (cota inferior).
   */
  private async unansweredIssues(base: string, now: Date): Promise<{ count: number; capped: boolean }> {
    const { data } = await this.get<GhIssue[]>(
      `${base}/issues?state=open&sort=created&direction=asc&per_page=${PER_PAGE}`,
    );
    const cutoff = Date.parse(isoDaysAgo(UNANSWERED_ISSUE_MIN_AGE_DAYS, now));
    const count = data.filter(
      (i) => !i.pull_request && i.comments === 0 && Date.parse(i.created_at) < cutoff,
    ).length;
    return { count, capped: data.length === PER_PAGE };
  }
}
