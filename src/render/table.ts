import chalk, { type ChalkInstance } from 'chalk';
import Table from 'cli-table3';
import { CATEGORY_LABELS, THRESHOLDS } from '../scoring/scoring.js';
import type { HealthCategory, PackageReport, Summary } from '../types.js';
import { daysSince } from '../utils.js';

const COLOR: Record<HealthCategory, ChalkInstance> = {
  healthy: chalk.green,
  caution: chalk.yellow,
  critical: chalk.red,
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function scoreCell(r: PackageReport): string {
  if (r.status === 'error') return chalk.red.bold('ERROR');
  if (r.status === 'not-evaluable' || !r.result) return chalk.gray('N/E');
  return COLOR[r.result.category].bold(String(r.result.score));
}

function maintainersCell(r: PackageReport): string {
  if (!r.github) return chalk.gray('—');
  const n = r.github.activeMaintainers;
  const text = `${n}${r.github.activeMaintainersCapped ? '+' : ''}`;
  return n <= 1 ? chalk.red(text) : n === 2 ? chalk.yellow(text) : text;
}

function alertCell(r: PackageReport, width: number): string {
  if (r.status === 'error') return chalk.red(truncate(r.reason ?? 'Error desconocido', width));
  if (r.status === 'not-evaluable') {
    const extra = r.npm?.deprecated ? ' · deprecated' : '';
    return chalk.gray(truncate(`No evaluable: ${r.reason ?? ''}${extra}`, width));
  }
  const alert = r.result?.mainAlert;
  if (!alert) return chalk.green('Sin alertas');
  const color = r.result ? COLOR[r.result.category] : (s: string) => s;
  return color(truncate(alert.message, width));
}

export function renderTable(reports: PackageReport[], now: Date): string {
  const alertWidth = Math.max(30, Math.min(70, (process.stdout.columns ?? 120) - 60));
  const table = new Table({
    head: ['Paquete', 'Score', 'Días últ. commit', 'Mant. activos', 'Alerta principal'].map((h) => chalk.bold(h)),
    style: { head: [], border: ['gray'] },
    wordWrap: false,
  });

  for (const r of reports) {
    const days = r.github ? daysSince(r.github.lastCommitAt, now) : null;
    const name = r.kind === 'devDependencies' ? `${r.name} ${chalk.gray('(dev)')}` : r.name;
    table.push([
      name,
      scoreCell(r),
      days === null ? chalk.gray('—') : String(days),
      maintainersCell(r),
      alertCell(r, alertWidth),
    ]);
  }
  return table.toString();
}

/** Desglose explicable de penalizaciones (flag --explain). */
export function renderExplain(reports: PackageReport[]): string {
  const lines: string[] = [chalk.bold('\nDesglose de penalizaciones:')];
  for (const r of reports) {
    if (r.status !== 'evaluated' || !r.result) continue;
    const color = COLOR[r.result.category];
    lines.push(`\n${color.bold(`${r.name} → ${r.result.score}/100 (${CATEGORY_LABELS[r.result.category]})`)}`);
    if (r.github?.redirected) lines.push(chalk.gray(`  repo: ${r.github.requestedFullName} → ${r.github.fullName}`));
    if (r.result.penalties.length === 0) lines.push(chalk.green('  Sin penalizaciones'));
    for (const p of r.result.penalties) lines.push(`  ${chalk.red(`-${p.points}`.padStart(4))}  ${p.message}`);
  }
  return lines.join('\n');
}

export function renderSummary(s: Summary): string {
  const parts = [
    chalk.red(`● Crítico/Fantasma (<${THRESHOLDS.caution}): ${s.critical}`),
    chalk.yellow(`● Precaución (${THRESHOLDS.caution}-${THRESHOLDS.healthy - 1}): ${s.caution}`),
    chalk.green(`● Saludable (≥${THRESHOLDS.healthy}): ${s.healthy}`),
    chalk.gray(`○ No evaluable: ${s.notEvaluable}`),
  ];
  if (s.errors > 0) parts.push(chalk.red.bold(`✖ Errores: ${s.errors}`));
  return `\n${chalk.bold(`Resumen (${s.total} dependencias):`)}  ${parts.join('   ')}`;
}
