/**
 * Tipos de dominio compartidos. Todas las fechas se manejan como strings ISO-8601
 * para que los objetos sean serializables tal cual (caché en disco y salida --json).
 */

export type DependencyKind = 'dependencies' | 'devDependencies' | 'transitive';

export interface DependencySpec {
  /** Nombre con el que aparece en package.json (clave). */
  name: string;
  /** Nombre real en el registry (difiere si es un alias `npm:otro@^1`). */
  registryName: string;
  /** Rango/especificador declarado (o versión resuelta en el lockfile para transitivas). */
  spec: string;
  kind: DependencyKind;
  /** 1 = directa; 2+ = transitiva (distancia mínima desde el proyecto). */
  depth: number;
  /** Cadena de dependencias por la que se llega a una transitiva (ej. ["express", "debug"]). */
  via: string[];
  /** Si está presente, la dependencia no proviene del registry y no se evalúa. */
  unsupportedReason?: string;
}

export type RepoHost = 'github' | 'gitlab' | 'bitbucket' | 'other';

export interface RepoRef {
  host: RepoHost;
  /** Hostname normalizado (sin `www.`). */
  hostname: string;
  owner: string;
  repo: string;
  /** URL canónica https://host/owner/repo */
  url: string;
  /** Subdirectorio dentro de un monorepo (campo `repository.directory`). */
  directory?: string;
}

export interface MaintainerChange {
  added: string[];
  removed: string[];
}

export interface NpmInfo {
  name: string;
  latestVersion: string | null;
  latestPublishedAt: string | null;
  /** Fecha de la versión anterior a la última (para detectar "resurrecciones"). */
  previousPublishedAt: string | null;
  deprecated: string | null;
  /** Maintainers actuales del paquete (nivel documento). */
  maintainers: string[];
  repository: RepoRef | null;
  rawRepositoryUrl: string | null;
  /** Usuario npm que publicó la última versión (`_npmUser`). */
  latestPublisher: string | null;
  /** Publicadores de las N versiones previas a la última. */
  previousPublishers: string[];
  /** Diferencia de maintainers entre la última versión y la anterior. null = sin datos. */
  maintainersChange: MaintainerChange | null;
}

export interface GitHubInfo {
  requestedFullName: string;
  fullName: string;
  /** true si GitHub redirigió (301) a otro owner/nombre: proxy de transferencia/renombre. */
  redirected: boolean;
  archived: boolean;
  defaultBranch: string;
  lastCommitAt: string | null;
  activeMaintainers: number;
  /** true si se alcanzó el tope de páginas de commits (el número real puede ser mayor). */
  activeMaintainersCapped: boolean;
  /** null si el repo tiene los issues deshabilitados. */
  unansweredIssues: number | null;
  unansweredIssuesCapped: boolean;
  /** Si se analizó un subdirectorio de monorepo, ruta usada para filtrar commits. */
  scopedToDirectory: string | null;
}

/** Señales normalizadas que consume el motor de scoring (puro, sin I/O). */
export interface HealthSignals {
  daysSinceLastCommit: number | null;
  daysSinceLastPublish: number | null;
  /** Días entre la penúltima y la última publicación. */
  publishGapDays: number | null;
  archived: boolean;
  deprecated: boolean;
  activeMaintainers: number | null;
  unansweredIssues: number | null;
  repoRedirected: boolean;
  maintainersAdded: string[];
  newPublisher: boolean;
}

export type PenaltyId =
  | 'archived'
  | 'deprecated'
  | 'abandoned'
  | 'stale-publish'
  | 'bus-factor'
  | 'unanswered-issues'
  | 'repo-redirect'
  | 'maintainers-changed'
  | 'new-publisher'
  | 'hijack-pattern';

export interface Penalty {
  id: PenaltyId;
  points: number;
  message: string;
}

export type HealthCategory = 'healthy' | 'caution' | 'critical';

export interface ScoreResult {
  score: number;
  category: HealthCategory;
  penalties: Penalty[];
  /** Penalización de mayor peso (null si no hay ninguna). */
  mainAlert: Penalty | null;
}

export type ReportStatus = 'evaluated' | 'not-evaluable' | 'error';

export interface PackageReport {
  name: string;
  registryName: string;
  spec: string;
  kind: DependencyKind;
  depth: number;
  via: string[];
  status: ReportStatus;
  /** Motivo de "No evaluable" o mensaje de error. */
  reason: string | null;
  npm: NpmInfo | null;
  github: GitHubInfo | null;
  signals: HealthSignals | null;
  result: ScoreResult | null;
}

export interface Summary {
  total: number;
  healthy: number;
  caution: number;
  critical: number;
  notEvaluable: number;
  errors: number;
}
