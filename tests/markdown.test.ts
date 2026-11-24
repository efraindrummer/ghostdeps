import { describe, expect, it } from 'vitest';
import { summarize, sortReports } from '../src/analyzer.js';
import { escapeCell, renderMarkdown } from '../src/render/markdown.js';
import type { PackageReport } from '../src/types.js';

function report(over: Partial<PackageReport>): PackageReport {
  return {
    name: 'pkg',
    registryName: 'pkg',
    spec: '^1',
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

const reports = sortReports([
  report({ name: 'good', result: { score: 100, category: 'healthy', penalties: [], mainAlert: null } }),
  report({
    name: 'ghost',
    kind: 'transitive',
    depth: 3,
    via: ['express', 'debug'],
    result: {
      score: 20,
      category: 'critical',
      penalties: [{ id: 'archived', points: 40, message: 'Repositorio | archivado' }],
      mainAlert: { id: 'archived', points: 40, message: 'Repositorio | archivado' },
    },
  }),
  report({ name: 'gitlab-pkg', status: 'not-evaluable', reason: 'Repo en GitLab' }),
]);

describe('renderMarkdown', () => {
  const md = renderMarkdown(reports, summarize(reports), new Date('2026-11-24T00:00:00Z'), {
    version: '0.2.0',
    projectName: 'demo',
    failUnder: 40,
    failing: ['ghost'],
    ignored: ['left-pad'],
  });

  it('incluye cabecera, resumen y tabla ordenada', () => {
    expect(md).toContain('## 👻 GhostDeps — `demo`');
    expect(md).toContain('🔴 1 crítico/fantasma');
    const ghostIdx = md.indexOf('`ghost`');
    const goodIdx = md.indexOf('`good`');
    expect(ghostIdx).toBeGreaterThan(-1);
    expect(ghostIdx).toBeLessThan(goodIdx);
  });

  it('muestra la ruta de las transitivas y escapa pipes', () => {
    expect(md).toContain('↳ express › debug');
    expect(md).toContain('Repositorio \\| archivado');
  });

  it('incluye aviso de fail-under, desglose, ignorados y no evaluables', () => {
    expect(md).toContain('[!CAUTION]');
    expect(md).toContain('<details>');
    expect(md).toContain('`-40`');
    expect(md).toContain('`left-pad`');
    expect(md).toContain('_No evaluable: Repo en GitLab_');
  });
});

describe('escapeCell', () => {
  it('escapa pipes, backslashes y saltos de línea', () => {
    expect(escapeCell('a|b\\c\nd')).toBe('a\\|b\\\\c d');
  });
});
