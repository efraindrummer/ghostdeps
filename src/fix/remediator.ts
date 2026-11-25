/**
 * Motor de remediación automática (ghostdeps fix).
 * Genera e inyecta overrides/resolutions en package.json para aislar
 * o actualizar dependencias transitivas vulnerables o fantasmas.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PackageReport } from '../types.js';

export type PackageManager = 'npm' | 'yarn' | 'pnpm';

export interface FixProposal {
  packageName: string;
  currentSpec: string;
  targetVersion: string;
  reason: string;
  severity: 'critical' | 'caution';
}

export interface FixPlan {
  packageManager: PackageManager;
  packageJsonPath: string;
  proposals: FixProposal[];
  originalContent: string;
  updatedContent: string;
  changesMade: boolean;
}

export interface FixOptions {
  dryRun?: boolean;
  backup?: boolean;
  packageManager?: PackageManager;
  customOverrides?: Record<string, string>;
}

/**
 * Detecta el gestor de paquetes predominante en base al lockfile del proyecto.
 */
export async function detectPackageManager(dir: string): Promise<PackageManager> {
  const check = async (filename: string): Promise<boolean> => {
    try {
      await readFile(path.resolve(dir, filename));
      return true;
    } catch {
      return false;
    }
  };

  if (await check('pnpm-lock.yaml')) return 'pnpm';
  if (await check('yarn.lock')) return 'yarn';
  return 'npm';
}

/**
 * Propone soluciones a partir de los reportes de análisis.
 */
export function generateProposals(
  reports: PackageReport[],
  customOverrides: Record<string, string> = {},
): FixProposal[] {
  const proposals: FixProposal[] = [];

  // Overrides explícitos proporcionados por el usuario
  for (const [pkgName, targetVersion] of Object.entries(customOverrides)) {
    proposals.push({
      packageName: pkgName,
      currentSpec: 'custom',
      targetVersion,
      reason: 'Override manual indicado por el usuario',
      severity: 'critical',
    });
  }

  for (const r of reports) {
    if (customOverrides[r.name]) continue;

    // Paquetes críticos o con scripts sospechosos
    if (r.result?.category === 'critical' || r.signals?.installScripts?.suspicious) {
      if (r.npm?.latestVersion && r.npm.latestVersion !== r.spec) {
        const reason = r.signals?.installScripts?.suspicious
          ? 'Posible versión comprometida por scripts de instalación'
          : r.result?.mainAlert?.message ?? 'Dependencia identificada como crítica';

        proposals.push({
          packageName: r.name,
          currentSpec: r.spec,
          targetVersion: r.npm.latestVersion,
          reason,
          severity: 'critical',
        });
      }
    }
  }

  return proposals;
}

/**
 * Genera el plan de modificación de package.json según el gestor (npm overrides, yarn resolutions, pnpm.overrides).
 */
export async function createFixPlan(
  packageJsonPath: string,
  proposals: FixProposal[],
  pm: PackageManager,
): Promise<FixPlan> {
  const raw = await readFile(packageJsonPath, 'utf8');
  const pkgJson = JSON.parse(raw) as Record<string, any>;

  let changesMade = false;

  if (proposals.length > 0) {
    if (pm === 'npm') {
      pkgJson.overrides = pkgJson.overrides ?? {};
      for (const p of proposals) {
        if (pkgJson.overrides[p.packageName] !== p.targetVersion) {
          pkgJson.overrides[p.packageName] = p.targetVersion;
          changesMade = true;
        }
      }
    } else if (pm === 'yarn') {
      pkgJson.resolutions = pkgJson.resolutions ?? {};
      for (const p of proposals) {
        if (pkgJson.resolutions[p.packageName] !== p.targetVersion) {
          pkgJson.resolutions[p.packageName] = p.targetVersion;
          changesMade = true;
        }
      }
    } else if (pm === 'pnpm') {
      pkgJson.pnpm = pkgJson.pnpm ?? {};
      pkgJson.pnpm.overrides = pkgJson.pnpm.overrides ?? {};
      for (const p of proposals) {
        if (pkgJson.pnpm.overrides[p.packageName] !== p.targetVersion) {
          pkgJson.pnpm.overrides[p.packageName] = p.targetVersion;
          changesMade = true;
        }
      }
    }
  }

  const updatedContent = JSON.stringify(pkgJson, null, 2) + '\n';

  return {
    packageManager: pm,
    packageJsonPath,
    proposals,
    originalContent: raw,
    updatedContent,
    changesMade,
  };
}

/**
 * Aplica el plan a disco. Si backup=true genera package.json.bak.
 */
export async function applyFixPlan(
  plan: FixPlan,
  options: { dryRun?: boolean; backup?: boolean } = {},
): Promise<{ written: boolean; backupPath?: string }> {
  if (options.dryRun || !plan.changesMade) {
    return { written: false };
  }

  let backupPath: string | undefined;
  if (options.backup) {
    backupPath = `${plan.packageJsonPath}.bak`;
    await writeFile(backupPath, plan.originalContent, 'utf8');
  }

  await writeFile(plan.packageJsonPath, plan.updatedContent, 'utf8');
  return { written: true, backupPath };
}
