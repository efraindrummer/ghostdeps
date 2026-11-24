import { describe, expect, it } from 'vitest';
import { renderSarif } from '../src/render/sarif.js';
import type { PackageReport } from '../src/types.js';

function dummyReport(over: Partial<PackageReport>): PackageReport {
  return {
    name: 'pkg',
    registryName: 'pkg',
    spec: '^1.0.0',
    kind: 'dependencies',
    depth: 1,
    via: [],
    status: 'evaluated',
    reason: null,
    npm: null,
    github: null,
    signals: null,
    result: null,
    ...over,
  };
}

describe('renderSarif', () => {
  const reports: PackageReport[] = [
    dummyReport({
      name: 'critical-pkg',
      result: {
        score: 20,
        category: 'critical',
        penalties: [
          { id: 'archived', points: 40, message: 'Repositorio archivado' },
          { id: 'abandoned', points: 40, message: 'Sin commits recientes' },
        ],
        mainAlert: { id: 'archived', points: 40, message: 'Repositorio archivado' },
      },
    }),
    dummyReport({
      name: 'caution-pkg',
      kind: 'transitive',
      depth: 2,
      via: ['root-pkg'],
      result: {
        score: 65,
        category: 'caution',
        penalties: [
          { id: 'bus-factor', points: 15, message: 'Bus factor = 1' },
          { id: 'unanswered-issues', points: 10, message: '12 issues sin respuesta' },
        ],
        mainAlert: { id: 'bus-factor', points: 15, message: 'Bus factor = 1' },
      },
    }),
    dummyReport({
      name: 'healthy-pkg',
      result: {
        score: 100,
        category: 'healthy',
        penalties: [],
        mainAlert: null,
      },
    }),
    dummyReport({
      name: 'not-evaluable-pkg',
      status: 'not-evaluable',
      reason: 'Sin repositorio GitHub',
    }),
  ];

  it('genera un documento SARIF 2.1.0 válido', () => {
    const raw = renderSarif(reports, {
      version: '0.2.0',
      manifestPath: '/path/to/project/package.json',
    });

    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.$schema).toContain('sarif');
    expect(parsed.runs).toHaveLength(1);

    const run = parsed.runs[0];
    expect(run.tool.driver.name).toBe('ghostdeps');
    expect(run.tool.driver.version).toBe('0.2.0');
    expect(run.tool.driver.rules.length).toBeGreaterThan(0);

    // Debe contener resultados solo para critical-pkg y caution-pkg
    expect(run.results).toHaveLength(2);

    const criticalResult = run.results.find((r: any) => r.properties.packageName === 'critical-pkg');
    expect(criticalResult).toBeDefined();
    expect(criticalResult.level).toBe('error');
    expect(criticalResult.ruleId).toBe('GD001'); // archived
    expect(criticalResult.locations[0].physicalLocation.artifactLocation.uri).toBe('package.json');

    const cautionResult = run.results.find((r: any) => r.properties.packageName === 'caution-pkg');
    expect(cautionResult).toBeDefined();
    expect(cautionResult.level).toBe('warning');
    expect(cautionResult.ruleId).toBe('GD004'); // bus-factor
    expect(cautionResult.message.text).toContain('(via root-pkg)');
  });
});
