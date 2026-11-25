import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyFixPlan, createFixPlan, generateProposals, type FixProposal } from '../src/fix/remediator.js';
import type { PackageReport } from '../src/types.js';

describe('generateProposals', () => {
  it('propone actualizaciones para paquetes críticos con versiones más recientes', () => {
    const reports: PackageReport[] = [
      {
        name: 'vulnerable-dep',
        registryName: 'vulnerable-dep',
        spec: '1.0.0',
        kind: 'transitive',
        depth: 2,
        via: ['my-app'],
        status: 'evaluated',
        reason: null,
        npm: {
          name: 'vulnerable-dep',
          latestVersion: '1.0.8',
          latestPublishedAt: '2024-01-01',
          previousPublishedAt: null,
          deprecated: null,
          maintainers: [],
          repository: null,
          rawRepositoryUrl: null,
          latestPublisher: null,
          previousPublishers: [],
          maintainersChange: null,
          installScripts: { hasInstallScripts: false, suspicious: false, scripts: [] },
        },
        github: null,
        signals: null,
        result: {
          score: 20,
          category: 'critical',
          penalties: [],
          mainAlert: { id: 'deprecated', points: 50, message: 'Paquete obsoleto' },
        },
      },
    ];

    const proposals = generateProposals(reports);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.packageName).toBe('vulnerable-dep');
    expect(proposals[0]?.targetVersion).toBe('1.0.8');
  });

  it('respeta overrides explícitos del usuario', () => {
    const proposals = generateProposals([], { 'custom-pkg': '2.0.0' });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.packageName).toBe('custom-pkg');
    expect(proposals[0]?.targetVersion).toBe('2.0.0');
  });
});

describe('createFixPlan y applyFixPlan', () => {
  it('genera overrides para npm en package.json', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'ghostdeps-fix-npm-'));
    const pkgPath = path.join(tmp, 'package.json');
    await writeFile(pkgPath, JSON.stringify({ name: 'test-app', version: '1.0.0' }, null, 2));

    const proposals: FixProposal[] = [
      {
        packageName: 'nested-bad',
        currentSpec: '1.0.0',
        targetVersion: '1.2.0',
        reason: 'Fix crítico',
        severity: 'critical',
      },
    ];

    const plan = await createFixPlan(pkgPath, proposals, 'npm');
    expect(plan.changesMade).toBe(true);
    const parsed = JSON.parse(plan.updatedContent);
    expect(parsed.overrides['nested-bad']).toBe('1.2.0');

    // Aplicar a disco con backup
    const res = await applyFixPlan(plan, { dryRun: false, backup: true });
    expect(res.written).toBe(true);
    expect(res.backupPath).toBeDefined();

    const diskContent = JSON.parse(await readFile(pkgPath, 'utf8'));
    expect(diskContent.overrides['nested-bad']).toBe('1.2.0');

    const backupContent = JSON.parse(await readFile(res.backupPath!, 'utf8'));
    expect(backupContent.overrides).toBeUndefined();

    await rm(tmp, { recursive: true, force: true });
  });

  it('genera resolutions para yarn y pnpm.overrides para pnpm', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'ghostdeps-fix-pm-'));
    const pkgPath = path.join(tmp, 'package.json');
    await writeFile(pkgPath, JSON.stringify({ name: 'test-app' }, null, 2));

    const proposals: FixProposal[] = [
      { packageName: 'foo', currentSpec: '1.0.0', targetVersion: '2.0.0', reason: 'Update', severity: 'critical' },
    ];

    const yarnPlan = await createFixPlan(pkgPath, proposals, 'yarn');
    expect(JSON.parse(yarnPlan.updatedContent).resolutions['foo']).toBe('2.0.0');

    const pnpmPlan = await createFixPlan(pkgPath, proposals, 'pnpm');
    expect(JSON.parse(pnpmPlan.updatedContent).pnpm.overrides['foo']).toBe('2.0.0');

    await rm(tmp, { recursive: true, force: true });
  });
});
