/**
 * Motor de puntuación (Health Score 0–100). Puro y determinista: recibe señales ya
 * normalizadas y devuelve el score, la categoría, las penalizaciones aplicadas y la
 * alerta principal. Todos los pesos viven aquí como constantes para poder ajustarlos.
 *
 * Convenciones:
 *  - Los umbrales de días son estrictos ("más de N días" => days > N).
 *  - Una señal desconocida (null) nunca penaliza: preferimos falsos negativos a castigar
 *    por falta de datos.
 *  - En escalas por tramos solo se aplica el tramo más alto alcanzado (no se acumulan).
 */
import type { HealthCategory, HealthSignals, Penalty, PenaltyId, ScoreResult } from '../types.js';

export interface Tier {
  /** Umbral del tramo (estricto para días, inclusivo para conteos; ver uso). */
  threshold: number;
  points: number;
}

export interface ScoringWeights {
  archived: number;
  deprecated: number;
  /** Días sin commits en la rama por defecto (umbral estricto: days > threshold). Orden descendente. */
  abandonment: readonly Tier[];
  /** Días desde la última publicación en npm (umbral estricto). */
  stalePublish: Tier;
  busFactor: { zero: number; one: number; two: number };
  /** Issues sin respuesta (umbral inclusivo: count >= threshold). Orden descendente. */
  unansweredIssues: readonly Tier[];
  repoRedirect: number;
  maintainersChanged: number;
  newPublisher: number;
  /** Extra si un publicador nuevo coincide con otra señal de transferencia o con una "resurrección". */
  hijackPattern: number;
  /** Hueco entre publicaciones que convierte a un publicador nuevo en "resurrección" sospechosa. */
  dormantRevivalDays: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = Object.freeze({
  archived: 40,
  deprecated: 40,
  abandonment: [
    { threshold: 730, points: 45 }, // > 24 meses
    { threshold: 365, points: 25 }, // > 12 meses
    { threshold: 180, points: 10 }, // > 6 meses
  ],
  stalePublish: { threshold: 730, points: 5 },
  busFactor: { zero: 20, one: 15, two: 5 },
  unansweredIssues: [
    { threshold: 25, points: 15 },
    { threshold: 10, points: 10 },
    { threshold: 3, points: 5 },
  ],
  repoRedirect: 10,
  maintainersChanged: 15,
  newPublisher: 15,
  hijackPattern: 15,
  dormantRevivalDays: 365,
});

export const THRESHOLDS = Object.freeze({
  /** score >= healthy => Verde */
  healthy: 70,
  /** score >= caution => Amarillo; por debajo => Rojo */
  caution: 40,
});

export const CATEGORY_LABELS: Record<HealthCategory, string> = {
  healthy: 'Saludable',
  caution: 'Precaución',
  critical: 'Crítico/Fantasma',
};

/** Prioridad para desempatar la alerta principal cuando dos penalizaciones pesan igual. */
const PRIORITY: readonly PenaltyId[] = [
  'hijack-pattern',
  'archived',
  'deprecated',
  'new-publisher',
  'maintainers-changed',
  'abandoned',
  'bus-factor',
  'repo-redirect',
  'unanswered-issues',
  'stale-publish',
];

export function categorize(score: number): HealthCategory {
  if (score >= THRESHOLDS.healthy) return 'healthy';
  if (score >= THRESHOLDS.caution) return 'caution';
  return 'critical';
}

function months(days: number): number {
  return Math.floor(days / 30);
}

export function computeScore(s: HealthSignals, w: ScoringWeights = DEFAULT_WEIGHTS): ScoreResult {
  const penalties: Penalty[] = [];
  const add = (id: PenaltyId, points: number, message: string) => {
    if (points > 0) penalties.push({ id, points, message });
  };

  if (s.archived) add('archived', w.archived, 'Repositorio archivado (solo lectura)');
  if (s.deprecated) add('deprecated', w.deprecated, 'Paquete marcado como deprecated en npm');

  if (s.daysSinceLastCommit !== null) {
    const days = s.daysSinceLastCommit;
    const tier = w.abandonment.find((t) => days > t.threshold);
    if (tier) add('abandoned', tier.points, `Sin commits desde hace ${days} días (~${months(days)} meses)`);
  }

  if (s.daysSinceLastPublish !== null && s.daysSinceLastPublish > w.stalePublish.threshold) {
    add('stale-publish', w.stalePublish.points, `Sin publicar en npm desde hace ${s.daysSinceLastPublish} días`);
  }

  if (s.activeMaintainers !== null) {
    const n = s.activeMaintainers;
    if (n <= 0) add('bus-factor', w.busFactor.zero, 'Ningún mantenedor activo en 12 meses');
    else if (n === 1) add('bus-factor', w.busFactor.one, 'Bus factor = 1 (un solo mantenedor activo)');
    else if (n === 2) add('bus-factor', w.busFactor.two, 'Bus factor = 2');
  }

  if (s.unansweredIssues !== null) {
    const n = s.unansweredIssues;
    const tier = w.unansweredIssues.find((t) => n >= t.threshold);
    if (tier) add('unanswered-issues', tier.points, `${n} issues abiertos >30 días sin respuesta`);
  }

  // --- Señales de transferencia / hijacking (proxies) ---
  if (s.repoRedirected) add('repo-redirect', w.repoRedirect, 'El repo redirige a otro owner/nombre (posible transferencia)');
  const maintainersChanged = s.maintainersAdded.length > 0;
  if (maintainersChanged) {
    add('maintainers-changed', w.maintainersChanged, `Nuevos maintainers en la última versión: ${s.maintainersAdded.join(', ')}`);
  }
  if (s.newPublisher) add('new-publisher', w.newPublisher, 'La última versión la publicó un usuario nuevo');

  const dormantRevival = s.publishGapDays !== null && s.publishGapDays > w.dormantRevivalDays;
  if (s.newPublisher && (maintainersChanged || s.repoRedirected || dormantRevival)) {
    const why = dormantRevival
      ? `tras ${s.publishGapDays} días sin publicar`
      : 'junto a otra señal de transferencia';
    add('hijack-pattern', w.hijackPattern, `Patrón de posible secuestro: publicador nuevo ${why}`);
  }

  const total = penalties.reduce((acc, p) => acc + p.points, 0);
  const score = Math.max(0, Math.min(100, 100 - total));

  const sorted = [...penalties].sort(
    (a, b) => b.points - a.points || PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id),
  );

  return {
    score,
    category: categorize(score),
    penalties: sorted,
    mainAlert: sorted[0] ?? null,
  };
}
