/**
 * Generador de reportes en formato SARIF 2.1.0 (Static Analysis Results Interchange Format)
 * Estándar de la industria para integración directa con GitHub Code Scanning,
 * GitLab Security y visores SARIF en CI/CD y editores.
 */
import path from 'node:path';
import type { PenaltyId, ScoreResult, PackageReport } from '../types.js';
import { THRESHOLDS, type Thresholds } from '../scoring/scoring.js';

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  defaultConfiguration: {
    level: 'error' | 'warning' | 'note';
  };
  helpUri?: string;
}

export const SARIF_RULES: Record<PenaltyId, SarifRule> = {
  'archived': {
    id: 'GD001',
    name: 'ArchivedRepository',
    shortDescription: { text: 'Repositorio archivado en la forja de código' },
    defaultConfiguration: { level: 'error' },
  },
  'deprecated': {
    id: 'GD002',
    name: 'DeprecatedPackage',
    shortDescription: { text: 'Paquete marcado como deprecated en el registry npm' },
    defaultConfiguration: { level: 'error' },
  },
  'abandoned': {
    id: 'GD003',
    name: 'AbandonedRepository',
    shortDescription: { text: 'Repositorio sin actividad de commits durante periodos prolongados' },
    defaultConfiguration: { level: 'error' },
  },
  'bus-factor': {
    id: 'GD004',
    name: 'LowBusFactor',
    shortDescription: { text: 'Riesgo de bus factor crítico (0 o 1 mantenedor activo en 12 meses)' },
    defaultConfiguration: { level: 'warning' },
  },
  'unanswered-issues': {
    id: 'GD005',
    name: 'UnansweredIssues',
    shortDescription: { text: 'Gran cantidad de issues abiertos antiguos sin respuesta' },
    defaultConfiguration: { level: 'note' },
  },
  'repo-redirect': {
    id: 'GD006',
    name: 'RepoRedirectTransfer',
    shortDescription: { text: 'El repositorio redirige a otro propietario (posible transferencia)' },
    defaultConfiguration: { level: 'warning' },
  },
  'maintainers-changed': {
    id: 'GD007',
    name: 'MaintainersSetChanged',
    shortDescription: { text: 'Cambios no habituales en la lista de maintainers de npm' },
    defaultConfiguration: { level: 'warning' },
  },
  'new-publisher': {
    id: 'GD008',
    name: 'NewReleasePublisher',
    shortDescription: { text: 'La última versión fue publicada por una cuenta nueva sin historial reciente' },
    defaultConfiguration: { level: 'warning' },
  },
  'hijack-pattern': {
    id: 'GD009',
    name: 'PotentialHijackingPattern',
    shortDescription: { text: 'Patrón combinado de posible secuestro de paquete o compromiso de cuenta' },
    defaultConfiguration: { level: 'error' },
  },
  'stale-publish': {
    id: 'GD010',
    name: 'StaleNpmPublish',
    shortDescription: { text: 'Tiempo excesivo transcurrido desde la última publicación en npm' },
    defaultConfiguration: { level: 'note' },
  },
};

export interface SarifOptions {
  version: string;
  manifestPath: string;
  thresholds?: Thresholds;
}

export function renderSarif(reports: PackageReport[], options: SarifOptions): string {
  const t = options.thresholds ?? THRESHOLDS;
  const manifestRel = path.basename(options.manifestPath) || 'package.json';

  const rulesList = Object.values(SARIF_RULES);

  const results = [];

  for (const r of reports) {
    if (r.status !== 'evaluated' || !r.result) continue;
    const res: ScoreResult = r.result;

    // Solo generar resultados si hay penalizaciones o score sub-óptimo
    if (res.penalties.length === 0) continue;

    const level: 'error' | 'warning' | 'note' =
      res.score < t.caution ? 'error' : res.score < t.healthy ? 'warning' : 'note';

    // Generar un resultado para la alerta principal
    const mainPenalty = res.mainAlert ?? res.penalties[0];
    const rule = mainPenalty ? SARIF_RULES[mainPenalty.id] : undefined;
    const ruleId = rule?.id ?? 'GD000';

    const viaText = r.via && r.via.length > 0 ? ` (via ${r.via.join(' › ')})` : '';
    const details = res.penalties.map((p) => `- [${p.id}] ${p.message} (-${p.points} pts)`).join('\n');

    results.push({
      ruleId,
      level,
      message: {
        text: `[Health Score ${res.score}/100] ${r.name}@${r.spec}${viaText}: ${mainPenalty?.message ?? 'Riesgo detectado'}`,
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: manifestRel,
              uriBaseId: '%SRCROOT%',
            },
            region: {
              startLine: 1,
            },
          },
        },
      ],
      properties: {
        packageName: r.name,
        spec: r.spec,
        kind: r.kind,
        depth: r.depth,
        via: r.via,
        score: res.score,
        category: res.category,
        penalties: res.penalties,
        details,
      },
    });
  }

  const sarifLog = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'ghostdeps',
            version: options.version,
            informationUri: 'https://github.com/ghostdeps/ghostdeps',
            rules: rulesList,
          },
        },
        results,
      },
    ],
  };

  return JSON.stringify(sarifLog, null, 2);
}
