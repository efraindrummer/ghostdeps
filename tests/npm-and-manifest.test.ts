import { describe, expect, it } from 'vitest';
import { extractNpmInfo, registryUrl, type NpmPackument } from '../src/clients/npm.js';
import { classifySpec, parseManifestContent } from '../src/parser/manifest.js';
import { buildSignals } from '../src/scoring/signals.js';
import type { GitHubInfo } from '../src/types.js';

const doc: NpmPackument = {
  name: 'demo',
  'dist-tags': { latest: '2.0.0' },
  maintainers: [{ name: 'alice' }, { name: 'mallory' }],
  time: {
    created: '2018-01-01T00:00:00.000Z',
    modified: '2026-10-01T00:00:00.000Z',
    '1.0.0': '2018-01-01T00:00:00.000Z',
    '1.1.0': '2019-01-01T00:00:00.000Z',
    '2.0.0': '2026-10-01T00:00:00.000Z',
  },
  versions: {
    '1.0.0': { _npmUser: { name: 'alice' }, maintainers: [{ name: 'alice' }] },
    '1.1.0': { _npmUser: { name: 'alice' }, maintainers: [{ name: 'alice' }] },
    '2.0.0': {
      _npmUser: { name: 'mallory' },
      maintainers: [{ name: 'alice' }, { name: 'mallory' }],
      repository: { type: 'git', url: 'git+https://github.com/alice/demo.git' },
    },
  },
};

describe('extractNpmInfo', () => {
  it('extrae publicador, cambios de maintainers, fechas y repo', () => {
    const info = extractNpmInfo('demo', doc);
    expect(info.latestVersion).toBe('2.0.0');
    expect(info.latestPublisher).toBe('mallory');
    expect(info.previousPublishers).toEqual(['alice']);
    expect(info.maintainersChange).toEqual({ added: ['mallory'], removed: [] });
    expect(info.previousPublishedAt).toBe('2019-01-01T00:00:00.000Z');
    expect(info.repository).toMatchObject({ owner: 'alice', repo: 'demo' });
    expect(info.deprecated).toBeNull();
  });

  it('usa homepage de GitHub como fallback y detecta deprecated', () => {
    const info = extractNpmInfo('x', {
      'dist-tags': { latest: '1.0.0' },
      time: { '1.0.0': '2020-01-01T00:00:00.000Z' },
      versions: { '1.0.0': { deprecated: 'use y instead', homepage: 'https://github.com/a/x#readme' } },
    });
    expect(info.repository).toMatchObject({ owner: 'a', repo: 'x' });
    expect(info.deprecated).toBe('use y instead');
    expect(info.maintainersChange).toBeNull();
  });

  it('codifica paquetes con scope', () => {
    expect(registryUrl('@types/node')).toBe('https://registry.npmjs.org/@types%2Fnode');
  });
});

describe('buildSignals', () => {
  it('detecta publicador nuevo y hueco entre publicaciones', () => {
    const gh: GitHubInfo = {
      requestedFullName: 'alice/demo',
      fullName: 'mallory/demo',
      redirected: true,
      archived: false,
      defaultBranch: 'main',
      lastCommitAt: '2026-11-01T00:00:00.000Z',
      activeMaintainers: 1,
      activeMaintainersCapped: false,
      unansweredIssues: 4,
      unansweredIssuesCapped: false,
      scopedToDirectory: null,
    };
    const s = buildSignals(extractNpmInfo('demo', doc), gh, new Date('2026-11-19T00:00:00.000Z'));
    expect(s.newPublisher).toBe(true);
    expect(s.maintainersAdded).toEqual(['mallory']);
    expect(s.repoRedirected).toBe(true);
    expect(s.daysSinceLastCommit).toBe(18);
    expect(s.publishGapDays).toBeGreaterThan(365);
  });
});

describe('manifest', () => {
  it('clasifica especificadores no-registry y alias', () => {
    expect(classifySpec('a', '^1.0.0', 'dependencies').unsupportedReason).toBeUndefined();
    expect(classifySpec('a', 'latest', 'dependencies').unsupportedReason).toBeUndefined();
    expect(classifySpec('a', 'file:../a', 'dependencies').unsupportedReason).toMatch(/local/);
    expect(classifySpec('a', 'workspace:*', 'dependencies').unsupportedReason).toBeDefined();
    expect(classifySpec('a', 'user/repo#main', 'dependencies').unsupportedReason).toMatch(/GitHub/);
    expect(classifySpec('lodash4', 'npm:lodash@^4', 'dependencies').registryName).toBe('lodash');
    expect(classifySpec('t', 'npm:@types/node@20', 'dependencies').registryName).toBe('@types/node');
  });

  it('incluye devDependencies solo con includeDev', () => {
    const content = JSON.stringify({ dependencies: { a: '1' }, devDependencies: { b: '1', a: '2' } });
    expect(parseManifestContent(content, 'p', { includeDev: false }).dependencies.map((d) => d.name)).toEqual(['a']);
    const withDev = parseManifestContent(content, 'p', { includeDev: true }).dependencies;
    expect(withDev.map((d) => `${d.name}:${d.kind}`)).toEqual(['a:dependencies', 'b:devDependencies']);
  });

  it('lanza ManifestError con JSON inválido', () => {
    expect(() => parseManifestContent('{nope', 'p', { includeDev: false })).toThrow(/JSON válido/);
  });
});
