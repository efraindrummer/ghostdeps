/**
 * Salida Markdown (GitHub Flavored), pensada para comentarios de PR y para
 * `$GITHUB_STEP_SUMMARY` en GitHub Actions. Sin colores ANSI.
 */
import { CATEGORY_LABELS, THRESHOLDS, type Thresholds } from '../scoring/scoring.js';
import type { HealthCategory, PackageReport, Summary } from '../types.js';
import { daysSince } from '../utils.js';

const ICON: Record<HealthCategory, string> = { healthy: '🟢', caution: '🟡', critical: '🔴' };

export interface MarkdownMeta {
  version: string;
  projectName: string | null;
  thresholds?: Thresholds;
  failUnder?: number;
  failing?: string[];
  ignored?: string[];
}

/** Escapa caracteres que romperían una celda de tabla Markdown. */
export function escapeCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function icon(r: PackageReport): string {
  if (r.status === 'error') return '❌';
  if (r.status === 'not-evaluable' || !r.result) return '⚪';
  return ICON[r.result.category];
}

function nameMd(r: PackageReport): string {
  const base = `\`${escapeCell(r.name)}\``;
  if (r.kind === 'devDependencies') return `${base} <sub>dev</sub>`;
  if (r.kind === 'transitive') return `${base}<br><sub>↳ ${escapeCell(r.via.join(' › '))}</sub>`;
  return base;
}

function alertMd(r: PackageReport): string {
  if (r.status === 'error') return `Error: ${escapeCell(r.reason ?? 'desconocido')}`;
  if (r.status === 'not-evaluable') return `_No evaluable: ${escapeCell(r.reason ?? '')}_`;
  return r.result?.mainAlert ? escapeCell(r.result.mainAlert.message) : 'Sin alertas';
}

export function renderMarkdown(reports: PackageReport[], summary: Summary, now: Date, meta: MarkdownMeta): string {
  const t = meta.thresholds ?? THRESHOLDS;
  const lines: string[] = [];
  const title = meta.projectName ? ` — \`${escapeCell(meta.projectName)}\`` : '';
  lines.push(`## 👻 GhostDeps${title}`, '');

  lines.push(
    `**${summary.total} dependencias:** 🔴 ${summary.critical} crítico/fantasma · 🟡 ${summary.caution} precaución · ` +
      `🟢 ${summary.healthy} saludable · ⚪ ${summary.notEvaluable} no evaluable` +
      (summary.errors > 0 ? ` · ❌ ${summary.errors} error(es)` : ''),
    '',
  );

  if (meta.failUnder !== undefined) {
    const failing = meta.failing ?? [];
    lines.push(
      failing.length > 0
        ? `> [!CAUTION]\n> ${failing.length} paquete(s) por debajo de \`--fail-under ${meta.failUnder}\`: ${failing.map((n) => `\`${escapeCell(n)}\``).join(', ')}`
        : `> [!TIP]\n> Ningún paquete evaluado por debajo de \`--fail-under ${meta.failUnder}\`.`,
      '',
    );
  }

  lines.push('| | Paquete | Score | Días últ. commit | Mant. activos | Alerta principal |');
  lines.push('|:-:|---|--:|--:|--:|---|');
  for (const r of reports) {
    const days = r.github ? daysSince(r.github.lastCommitAt, now) : null;
    const score = r.result ? `**${r.result.score}**` : r.status === 'error' ? 'ERROR' : 'N/E';
    const maint = r.github ? `${r.github.activeMaintainers}${r.github.activeMaintainersCapped ? '+' : ''}` : '—';
    lines.push(`| ${icon(r)} | ${nameMd(r)} | ${score} | ${days ?? '—'} | ${maint} | ${alertMd(r)} |`);
  }

  const detailed = reports.filter((r) => r.result && r.result.penalties.length > 0);
  if (detailed.length > 0) {
    lines.push('', '<details>', '<summary>Desglose de penalizaciones</summary>', '');
    for (const r of detailed) {
      const res = r.result!;
      lines.push(`**\`${escapeCell(r.name)}\` → ${res.score}/100 (${CATEGORY_LABELS[res.category]})**`, '');
      for (const p of res.penalties) lines.push(`- \`-${p.points}\` ${escapeCell(p.message)}`);
      lines.push('');
    }
    lines.push('</details>');
  }

  lines.push('');
  if (meta.ignored && meta.ignored.length > 0) {
    lines.push(`<sub>Ignorados: ${meta.ignored.map((n) => `\`${escapeCell(n)}\``).join(', ')}</sub><br>`);
  }
  lines.push(
    `<sub>Umbrales: 🟢 ≥ ${t.healthy} · 🟡 ${t.caution}–${t.healthy - 1} · 🔴 < ${t.caution} · ` +
      `Generado por GhostDeps v${meta.version} el ${now.toISOString().slice(0, 10)}</sub>`,
  );
  return lines.join('\n');
}
