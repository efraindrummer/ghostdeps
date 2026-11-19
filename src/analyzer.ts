import type { GitHubClient } from './clients/github.js';
import type { NpmClient } from './clients/npm.js';
import { NotFoundError, errorMessage } from './errors.js';
import { computeScore } from './scoring/scoring.js';
import { buildSignals } from './scoring/signals.js';
import type { DependencySpec, PackageReport, Summary } from './types.js';
import { mapWithConcurrency } from './utils.js';

export interface AnalyzerDeps {
  npm: NpmClient;
  github: GitHubClient;
  now: Date;
}

const HOST_LABEL: Record<string, string> = { gitlab: 'GitLab', bitbucket: 'Bitbucket' };

function baseReport(dep: DependencySpec): PackageReport {
  return {
    name: dep.name,
    registryName: dep.registryName,
    spec: dep.spec,
    kind: dep.kind,
    status: 'evaluated',
    reason: null,
    npm: null,
    github: null,
    signals: null,
    result: null,
  };
}

/** Analiza un paquete. Nunca lanza: cualquier fallo se refleja en `status`/`reason`. */
export async function analyzePackage(dep: DependencySpec, deps: AnalyzerDeps): Promise<PackageReport> {
  const report = baseReport(dep);
  const notEvaluable = (reason: string): PackageReport => ({ ...report, status: 'not-evaluable', reason });
  const failed = (err: unknown): PackageReport => ({ ...report, status: 'error', reason: errorMessage(err) });

  if (dep.unsupportedReason) return notEvaluable(dep.unsupportedReason);

  try {
    report.npm = await deps.npm.getPackageInfo(dep.registryName);
  } catch (err) {
    if (err instanceof NotFoundError) return notEvaluable('No existe en el registry público de npm (¿privado?)');
    return failed(err);
  }

  const repo = report.npm.repository;
  if (!repo) return notEvaluable('Sin campo "repository" en npm');
  if (repo.host !== 'github') {
    const host = HOST_LABEL[repo.host] ?? repo.hostname;
    return notEvaluable(`Repo en ${host}: solo GitHub está soportado en el MVP`);
  }

  try {
    report.github = await deps.github.getRepoHealth(repo.owner, repo.repo, repo.directory);
  } catch (err) {
    if (err instanceof NotFoundError) return notEvaluable(`Repo ${repo.owner}/${repo.repo} no encontrado o privado`);
    // RateLimitError, TimeoutError, HttpError...: el paquete queda como error y el análisis sigue.
    return failed(err);
  }

  report.signals = buildSignals(report.npm, report.github, deps.now);
  report.result = computeScore(report.signals);
  return report;
}

export async function analyzeAll(
  dependencies: DependencySpec[],
  deps: AnalyzerDeps,
  concurrency: number,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<PackageReport[]> {
  let done = 0;
  return mapWithConcurrency(dependencies, concurrency, async (dep) => {
    const r = await analyzePackage(dep, deps);
    onProgress?.(++done, dependencies.length, dep.name);
    return r;
  });
}

const STATUS_ORDER = { evaluated: 0, 'not-evaluable': 1, error: 2 } as const;

/** Peor score primero; después "No evaluable" y por último errores. */
export function sortReports(reports: PackageReport[]): PackageReport[] {
  return [...reports].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    const diff = (a.result?.score ?? 0) - (b.result?.score ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

export function summarize(reports: PackageReport[]): Summary {
  const summary: Summary = { total: reports.length, healthy: 0, caution: 0, critical: 0, notEvaluable: 0, errors: 0 };
  for (const r of reports) {
    if (r.status === 'error') summary.errors++;
    else if (r.status === 'not-evaluable') summary.notEvaluable++;
    else if (r.result) summary[r.result.category]++;
  }
  return summary;
}
