import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, THRESHOLDS, categorize, computeScore, type ScoringWeights } from '../src/scoring/scoring.js';
import type { HealthSignals } from '../src/types.js';

/** Señales de un paquete "perfecto": ninguna penalización. */
function healthy(overrides: Partial<HealthSignals> = {}): HealthSignals {
  return {
    daysSinceLastCommit: 3,
    daysSinceLastPublish: 20,
    publishGapDays: 30,
    archived: false,
    deprecated: false,
    activeMaintainers: 5,
    unansweredIssues: 0,
    repoRedirected: false,
    maintainersAdded: [],
    newPublisher: false,
    ...overrides,
  };
}

const ids = (s: HealthSignals) => computeScore(s).penalties.map((p) => p.id);

describe('computeScore – base', () => {
  it('un paquete sano obtiene 100, categoría healthy y sin alerta principal', () => {
    const r = computeScore(healthy());
    expect(r.score).toBe(100);
    expect(r.category).toBe('healthy');
    expect(r.penalties).toEqual([]);
    expect(r.mainAlert).toBeNull();
  });

  it('las señales desconocidas (null) no penalizan', () => {
    const r = computeScore(
      healthy({
        daysSinceLastCommit: null,
        daysSinceLastPublish: null,
        publishGapDays: null,
        activeMaintainers: null,
        unansweredIssues: null,
      }),
    );
    expect(r.score).toBe(100);
  });

  it('la suma de penalizaciones nunca baja de 0 (clamp)', () => {
    const r = computeScore(
      healthy({
        archived: true,
        deprecated: true,
        daysSinceLastCommit: 5000,
        daysSinceLastPublish: 5000,
        activeMaintainers: 0,
        unansweredIssues: 500,
        repoRedirected: true,
        maintainersAdded: ['mallory'],
        newPublisher: true,
        publishGapDays: 2000,
      }),
    );
    expect(r.score).toBe(0);
    expect(r.category).toBe('critical');
  });

  it('score = 100 - suma exacta de puntos aplicados', () => {
    const r = computeScore(healthy({ archived: true, activeMaintainers: 1 }));
    const total = r.penalties.reduce((a, p) => a + p.points, 0);
    expect(total).toBe(DEFAULT_WEIGHTS.archived + DEFAULT_WEIGHTS.busFactor.one);
    expect(r.score).toBe(100 - total);
  });
});

describe('computeScore – abandono (umbrales estrictos)', () => {
  it.each([
    [180, 0],
    [181, 10],
    [365, 10],
    [366, 25],
    [730, 25],
    [731, 45],
  ])('%i días sin commits => -%i', (days, points) => {
    const r = computeScore(healthy({ daysSinceLastCommit: days }));
    const p = r.penalties.find((x) => x.id === 'abandoned');
    expect(p?.points ?? 0).toBe(points);
  });

  it('solo aplica el tramo más alto, no acumula tramos', () => {
    const r = computeScore(healthy({ daysSinceLastCommit: 1000 }));
    expect(r.penalties.filter((p) => p.id === 'abandoned')).toHaveLength(1);
    expect(r.score).toBe(55);
  });

  it('publicación antigua solo penaliza por encima de 730 días', () => {
    expect(ids(healthy({ daysSinceLastPublish: 730 }))).not.toContain('stale-publish');
    expect(ids(healthy({ daysSinceLastPublish: 731 }))).toContain('stale-publish');
  });
});

describe('computeScore – bus factor', () => {
  it.each([
    [0, DEFAULT_WEIGHTS.busFactor.zero],
    [1, DEFAULT_WEIGHTS.busFactor.one],
    [2, DEFAULT_WEIGHTS.busFactor.two],
    [3, 0],
  ])('%i mantenedores activos => -%i', (n, points) => {
    const r = computeScore(healthy({ activeMaintainers: n }));
    expect(100 - r.score).toBe(points);
  });
});

describe('computeScore – issues sin respuesta (umbrales inclusivos)', () => {
  it.each([
    [2, 0],
    [3, 5],
    [9, 5],
    [10, 10],
    [24, 10],
    [25, 15],
    [1000, 15],
  ])('%i issues => -%i', (n, points) => {
    expect(100 - computeScore(healthy({ unansweredIssues: n })).score).toBe(points);
  });
});

describe('computeScore – señales de hijacking', () => {
  it('redirect de repo por sí solo es una penalización leve', () => {
    const r = computeScore(healthy({ repoRedirected: true }));
    expect(r.score).toBe(100 - DEFAULT_WEIGHTS.repoRedirect);
    expect(ids(healthy({ repoRedirected: true }))).not.toContain('hijack-pattern');
  });

  it('publicador nuevo aislado (sin otra señal ni hueco largo) no activa el patrón combinado', () => {
    expect(ids(healthy({ newPublisher: true, publishGapDays: 365 }))).toEqual(['new-publisher']);
  });

  it('publicador nuevo + maintainers nuevos activa el patrón combinado', () => {
    const r = computeScore(healthy({ newPublisher: true, maintainersAdded: ['mallory'] }));
    expect(r.penalties.map((p) => p.id).sort()).toEqual(['hijack-pattern', 'maintainers-changed', 'new-publisher']);
    expect(r.score).toBe(100 - 15 - 15 - 15);
    expect(r.penalties.find((p) => p.id === 'maintainers-changed')?.message).toContain('mallory');
  });

  it('publicador nuevo + redirect activa el patrón combinado', () => {
    expect(ids(healthy({ newPublisher: true, repoRedirected: true }))).toContain('hijack-pattern');
  });

  it('publicador nuevo tras >365 días sin publicar ("resurrección") activa el patrón (borde 365/366)', () => {
    expect(ids(healthy({ newPublisher: true, publishGapDays: 365 }))).not.toContain('hijack-pattern');
    expect(ids(healthy({ newPublisher: true, publishGapDays: 366 }))).toContain('hijack-pattern');
  });

  it('maintainers nuevos sin publicador nuevo no activan el patrón', () => {
    expect(ids(healthy({ maintainersAdded: ['bob'] }))).toEqual(['maintainers-changed']);
  });
});

describe('categorías y umbrales', () => {
  it.each([
    [100, 'healthy'],
    [70, 'healthy'],
    [69, 'caution'],
    [40, 'caution'],
    [39, 'critical'],
    [0, 'critical'],
  ] as const)('score %i => %s', (score, category) => {
    expect(categorize(score)).toBe(category);
  });

  it('los umbrales exportados coinciden con la especificación', () => {
    expect(THRESHOLDS).toEqual({ healthy: 70, caution: 40 });
  });

  it('exactamente 30 puntos de penalización => 70 (verde, borde)', () => {
    // abandono >6m (10) + bus factor 0 (20)
    const r = computeScore(healthy({ daysSinceLastCommit: 200, activeMaintainers: 0 }));
    expect(r.score).toBe(70);
    expect(r.category).toBe('healthy');
  });

  it('exactamente 60 puntos => 40 (amarillo, borde) y 61 => rojo', () => {
    // archivado (40) + bus factor 0 (20) = 60
    const r60 = computeScore(healthy({ archived: true, activeMaintainers: 0 }));
    expect(r60.score).toBe(40);
    expect(r60.category).toBe('caution');
    const custom: ScoringWeights = { ...DEFAULT_WEIGHTS, busFactor: { zero: 21, one: 15, two: 5 } };
    const r61 = computeScore(healthy({ archived: true, activeMaintainers: 0 }), custom);
    expect(r61.score).toBe(39);
    expect(r61.category).toBe('critical');
  });

  it('un paquete abandonado >24 meses sin mantenedores queda en rojo', () => {
    const r = computeScore(healthy({ daysSinceLastCommit: 900, activeMaintainers: 0 }));
    expect(r.score).toBe(35);
    expect(r.category).toBe('critical');
  });
});

describe('explicabilidad', () => {
  it('la alerta principal es la de mayor peso y las penalizaciones vienen ordenadas', () => {
    const r = computeScore(healthy({ daysSinceLastCommit: 400, activeMaintainers: 1, unansweredIssues: 4 }));
    expect(r.mainAlert?.id).toBe('abandoned');
    const points = r.penalties.map((p) => p.points);
    expect(points).toEqual([...points].sort((a, b) => b - a));
  });

  it('en empate de puntos desempata por prioridad (archived antes que deprecated)', () => {
    const r = computeScore(healthy({ archived: true, deprecated: true }));
    expect(r.mainAlert?.id).toBe('archived');
  });

  it('los pesos son inyectables y un peso 0 elimina la penalización', () => {
    const r = computeScore(healthy({ deprecated: true }), { ...DEFAULT_WEIGHTS, deprecated: 0 });
    expect(r.score).toBe(100);
    expect(r.penalties).toHaveLength(0);
  });

  it('cada penalización incluye un mensaje legible', () => {
    const r = computeScore(healthy({ archived: true, daysSinceLastCommit: 800, unansweredIssues: 30 }));
    for (const p of r.penalties) expect(p.message.length).toBeGreaterThan(5);
    expect(r.penalties.find((p) => p.id === 'abandoned')?.message).toContain('800');
  });
});
