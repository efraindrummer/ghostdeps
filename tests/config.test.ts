import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIgnoreMatcher, loadConfig, parseConfig } from '../src/config.js';
import { ConfigError } from '../src/errors.js';
import { DEFAULT_WEIGHTS, THRESHOLDS, computeScore } from '../src/scoring/scoring.js';
import type { HealthSignals } from '../src/types.js';

describe('parseConfig', () => {
  it('sin claves devuelve los valores por defecto', () => {
    const c = parseConfig({}, 'x');
    expect(c.weights).toEqual(DEFAULT_WEIGHTS);
    expect(c.thresholds).toEqual(THRESHOLDS);
    expect(c.ignore).toEqual([]);
  });

  it('fusiona pesos parciales sin perder el resto', () => {
    const c = parseConfig({ weights: { archived: 60, busFactor: { one: 5 } } }, 'x');
    expect(c.weights.archived).toBe(60);
    expect(c.weights.deprecated).toBe(DEFAULT_WEIGHTS.deprecated);
    expect(c.weights.busFactor).toEqual({ zero: 20, one: 5, two: 5 });
    // No muta los defaults
    expect(DEFAULT_WEIGHTS.busFactor.one).toBe(15);
  });

  it('ordena los tramos de mayor a menor umbral', () => {
    const c = parseConfig(
      { weights: { abandonment: [{ threshold: 90, points: 5 }, { threshold: 365, points: 30 }] } },
      'x',
    );
    expect(c.weights.abandonment.map((t) => t.threshold)).toEqual([365, 90]);
  });

  it.each([
    [{ unknownKey: 1 }, /desconocida/],
    [{ weights: { archivd: 10 } }, /archivd/],
    [{ weights: { archived: 150 } }, /entre 0 y 100/],
    [{ thresholds: { healthy: 50, caution: 60 } }, /no puede ser mayor/],
    [{ ignore: 'left-pad' }, /array/],
    [{ depth: 0 }, /entre 1 y 100/],
    [{ concurrency: 2.5 }, /entero/],
    [{ dev: 'yes' }, /true o false/],
    [[], /objeto/],
  ])('rechaza configuración inválida %j', (raw, msg) => {
    expect(() => parseConfig(raw, 'cfg')).toThrow(ConfigError);
    expect(() => parseConfig(raw, 'cfg')).toThrow(msg);
  });

  it('los umbrales personalizados cambian la categoría', () => {
    const c = parseConfig({ thresholds: { healthy: 95, caution: 50 } }, 'x');
    const signals: HealthSignals = {
      daysSinceLastCommit: 200, // -10
      daysSinceLastPublish: 10,
      publishGapDays: 10,
      archived: false,
      deprecated: false,
      activeMaintainers: 5,
      unansweredIssues: 0,
      repoRedirected: false,
      maintainersAdded: [],
      newPublisher: false,
    };
    expect(computeScore(signals).category).toBe('healthy');
    expect(computeScore(signals, c.weights, c.thresholds).category).toBe('caution');
  });
});

describe('createIgnoreMatcher', () => {
  const m = createIgnoreMatcher(['left-pad', '@types/*', 'eslint-*']);
  it.each([
    ['left-pad', true],
    ['left-pad2', false],
    ['@types/node', true],
    ['@typesx/node', false],
    ['eslint-plugin-react', true],
    ['eslint', false],
  ])('%s => %s', (name, expected) => {
    expect(m(name)).toBe(expected);
  });

  it('escapa caracteres de regex', () => {
    expect(createIgnoreMatcher(['a.b'])('axb')).toBe(false);
  });
});

describe('loadConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ghostdeps-cfg-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sin archivos devuelve defaults con source null', async () => {
    const c = await loadConfig(dir);
    expect(c.source).toBeNull();
  });

  it('lee la clave "ghostdeps" de package.json', async () => {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ ghostdeps: { failUnder: 50 } }));
    const c = await loadConfig(dir);
    expect(c.failUnder).toBe(50);
    expect(c.source).toContain('package.json');
  });

  it('.ghostdepsrc.json tiene prioridad sobre package.json', async () => {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ ghostdeps: { failUnder: 50 } }));
    await writeFile(path.join(dir, '.ghostdepsrc.json'), JSON.stringify({ failUnder: 30 }));
    expect((await loadConfig(dir)).failUnder).toBe(30);
  });

  it('--config inexistente lanza ConfigError', async () => {
    await expect(loadConfig(dir, path.join(dir, 'nope.json'))).rejects.toBeInstanceOf(ConfigError);
  });

  it('JSON inválido lanza ConfigError', async () => {
    await writeFile(path.join(dir, '.ghostdepsrc'), '{nope');
    await expect(loadConfig(dir)).rejects.toThrow(/JSON válido/);
  });

  it('el archivo de ejemplo del repo es válido', async () => {
    const example = path.resolve(__dirname, '../examples/.ghostdepsrc.json');
    const c = await loadConfig(dir, example);
    expect(c.weights.archived).toBe(50);
    expect(c.ignore).toContain('@types/*');
  });
});
