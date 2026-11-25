/**
 * Generador de reportes visuales interactivos y autónomos en HTML.
 * Diseñado para auditorías de seguridad, artifact de CI/CD e inspección visual
 * sin dependencias externas (100% self-contained).
 */
import { CATEGORY_LABELS, THRESHOLDS, type Thresholds } from '../scoring/scoring.js';
import type { HealthCategory, PackageReport, Summary } from '../types.js';
import { daysSince } from '../utils.js';

export interface HtmlMeta {
  version: string;
  projectName: string | null;
  thresholds?: Thresholds;
  failUnder?: number;
  failing?: string[];
  ignored?: string[];
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CATEGORY_COLORS: Record<HealthCategory, { bg: string; text: string; border: string }> = {
  healthy: { bg: '#064e3b', text: '#34d399', border: '#059669' },
  caution: { bg: '#78350f', text: '#fcd34d', border: '#d97706' },
  critical: { bg: '#7f1d1d', text: '#fca5a5', border: '#dc2626' },
};

export function renderHtml(
  reports: PackageReport[],
  summary: Summary,
  now: Date,
  meta: HtmlMeta,
): string {
  const t = meta.thresholds ?? THRESHOLDS;
  const projectTitle = meta.projectName ? escapeHtml(meta.projectName) : 'Proyecto';
  const isoDate = now.toISOString().slice(0, 10);

  const rowsHtml = reports
    .map((r, idx) => {
      const category: HealthCategory = r.result?.category ?? 'healthy';
      const score = r.result ? r.result.score : r.status === 'error' ? 'ERR' : 'N/E';
      const days = r.github ? daysSince(r.github.lastCommitAt, now) : null;
      const maint = r.github
        ? `${r.github.activeMaintainers}${r.github.activeMaintainersCapped ? '+' : ''}`
        : '—';
      const alert =
        r.status === 'error'
          ? `Error: ${r.reason ?? 'desconocido'}`
          : r.status === 'not-evaluable'
            ? `No evaluable: ${r.reason ?? ''}`
            : r.result?.mainAlert
              ? r.result.mainAlert.message
              : 'Sin alertas';

      const hasScripts = Boolean(r.signals?.installScripts?.suspicious);
      const rowClass = `report-row cat-${category} ${hasScripts ? 'has-scripts' : ''}`;
      const statusIcon =
        r.status === 'error'
          ? '❌'
          : r.status === 'not-evaluable'
            ? '⚪'
            : category === 'critical'
              ? '🔴'
              : category === 'caution'
                ? '🟡'
                : '🟢';

      const kindBadge =
        r.kind === 'devDependencies'
          ? '<span class="badge badge-dev">dev</span>'
          : r.kind === 'transitive'
            ? `<span class="badge badge-trans" title="Vía: ${escapeHtml(r.via.join(' › '))}">transitiva</span>`
            : '<span class="badge badge-prod">prod</span>';

      const scriptBadge = hasScripts
        ? '<span class="badge badge-warn" title="Scripts sospechosos detectados">⚠️ script</span>'
        : '';

      const penaltiesHtml =
        r.result && r.result.penalties.length > 0
          ? `<div class="detail-block">
               <h4>Penalizaciones aplicadas</h4>
               <ul class="penalties-list">
                 ${r.result.penalties
                   .map(
                     (p) =>
                       `<li><span class="penalty-pts">-${p.points}</span> <span>${escapeHtml(p.message)}</span></li>`,
                   )
                   .join('')}
               </ul>
             </div>`
          : '<p class="text-muted">No se aplicaron penalizaciones.</p>';

      const scriptsDetail =
        r.npm?.installScripts && r.npm.installScripts.scripts.length > 0
          ? `<div class="detail-block">
               <h4>Lifecycle Scripts (${r.npm.installScripts.scripts.length})</h4>
               <div class="scripts-list">
                 ${r.npm.installScripts.scripts
                   .map((s) => {
                     const isSusp = s.suspicious;
                     return `<div class="script-item ${isSusp ? 'suspicious' : ''}">
                       <span class="script-stage">${escapeHtml(s.stage)}</span>
                       <code>${escapeHtml(s.command)}</code>
                       ${isSusp && s.reason ? `<span class="pattern-tag">${escapeHtml(s.reason)}</span>` : ''}
                     </div>`;
                   })
                   .join('')}
               </div>
             </div>`
          : '';

      const viaDetail =
        r.via && r.via.length > 0
          ? `<div class="detail-block">
               <h4>Cadena de dependencia</h4>
               <div class="via-chain">${escapeHtml(r.via.join(' › '))} › <strong>${escapeHtml(r.name)}</strong></div>
             </div>`
          : '';

      const linksDetail = `
        <div class="detail-block links-block">
          <a href="https://www.npmjs.com/package/${encodeURIComponent(r.registryName)}" target="_blank" rel="noopener noreferrer" class="link-btn">Ver en npm ↗</a>
          ${
            r.github
              ? `<a href="https://github.com/${encodeURIComponent(r.github.fullName)}" target="_blank" rel="noopener noreferrer" class="link-btn">GitHub (${escapeHtml(r.github.fullName)}) ↗</a>`
              : ''
          }
        </div>
      `;

      return `
        <tr class="${rowClass}" data-index="${idx}" onclick="toggleDetails(${idx})">
          <td class="text-center">${statusIcon}</td>
          <td>
            <div class="pkg-name">
              <strong>${escapeHtml(r.name)}</strong>
              ${kindBadge}
              ${scriptBadge}
            </div>
            <div class="pkg-spec text-muted">${escapeHtml(r.spec)}</div>
          </td>
          <td class="text-center font-mono">
            <span class="score-badge score-${category}">${score}</span>
          </td>
          <td class="text-center">${days !== null ? `${days}d` : '—'}</td>
          <td class="text-center">${maint}</td>
          <td>${escapeHtml(alert)}</td>
        </tr>
        <tr id="details-${idx}" class="details-row" style="display: none;">
          <td colspan="6">
            <div class="details-content">
              ${penaltiesHtml}
              ${scriptsDetail}
              ${viaDetail}
              ${linksDetail}
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GhostDeps Reporte — ${projectTitle}</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --crit: #ef4444;
      --crit-bg: #450a0a;
      --caut: #f59e0b;
      --caut-bg: #451a03;
      --good: #10b981;
      --good-bg: #022c22;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 2rem 1rem;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 1.5rem;
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }
    h1 {
      font-size: 1.8rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .header-meta {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-top: 0.25rem;
    }
    /* Summary Cards */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 1rem 1.25rem;
    }
    .card-title {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.25rem;
    }
    .card-value {
      font-size: 2rem;
      font-weight: 700;
      font-family: var(--font-mono);
    }
    .card-crit { border-left: 4px solid var(--crit); color: #fca5a5; }
    .card-caut { border-left: 4px solid var(--caut); color: #fcd34d; }
    .card-good { border-left: 4px solid var(--good); color: #6ee7b7; }
    .card-total { border-left: 4px solid var(--accent); color: #bae6fd; }

    /* Controls / Filters */
    .controls-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1.5rem;
      align-items: center;
      justify-content: space-between;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .btn-filter {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.15s ease;
    }
    .btn-filter:hover, .btn-filter.active {
      background: #334155;
      border-color: var(--accent);
      color: #fff;
    }
    .search-box {
      position: relative;
      min-width: 260px;
    }
    .search-input {
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      font-size: 0.9rem;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--accent);
    }

    /* Table */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.9rem;
    }
    th {
      background: #1e293b;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--card-border);
      color: var(--text-muted);
      font-weight: 600;
      white-space: nowrap;
    }
    td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #1e293b;
      vertical-align: middle;
    }
    tr.report-row {
      cursor: pointer;
      transition: background 0.1s ease;
      border-bottom: 1px solid #334155;
    }
    tr.report-row:hover {
      background: #273549;
    }
    .text-center { text-align: center; }
    .font-mono { font-family: var(--font-mono); }
    .text-muted { color: var(--text-muted); font-size: 0.8rem; }

    .pkg-name {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.95rem;
    }
    .badge {
      font-size: 0.7rem;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-weight: 500;
      text-transform: uppercase;
    }
    .badge-prod { background: #1e3a8a; color: #93c5fd; }
    .badge-dev { background: #374151; color: #d1d5db; }
    .badge-trans { background: #312e81; color: #c7d2fe; }
    .badge-warn { background: #78350f; color: #fde68a; font-weight: 600; }

    .score-badge {
      display: inline-block;
      min-width: 2.2rem;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      font-weight: bold;
      text-align: center;
    }
    .score-healthy { background: var(--good-bg); color: #34d399; border: 1px solid #059669; }
    .score-caution { background: var(--caut-bg); color: #fcd34d; border: 1px solid #d97706; }
    .score-critical { background: var(--crit-bg); color: #fca5a5; border: 1px solid #dc2626; }

    /* Details Row */
    .details-row td {
      background: #0f172a;
      padding: 1.25rem;
      border-bottom: 1px solid var(--card-border);
    }
    .details-content {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .detail-block h4 {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--accent);
      margin-bottom: 0.5rem;
    }
    .penalties-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .penalties-list li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.85rem;
    }
    .penalty-pts {
      background: var(--crit-bg);
      color: #fca5a5;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 0.1rem 0.35rem;
      border-radius: 3px;
      font-weight: bold;
    }
    .scripts-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .script-item {
      background: #1e293b;
      padding: 0.4rem 0.6rem;
      border-radius: 4px;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .script-item.suspicious {
      border-left: 3px solid var(--crit);
      background: #2a1515;
    }
    .script-stage {
      color: var(--text-muted);
      font-weight: 600;
    }
    .pattern-tag {
      background: #991b1b;
      color: #fecaca;
      font-size: 0.7rem;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
    }
    .via-chain {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      color: #cbd5e1;
    }
    .links-block {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.25rem;
    }
    .link-btn {
      color: var(--accent);
      text-decoration: none;
      font-size: 0.85rem;
      border: 1px solid #0284c7;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      transition: background 0.15s ease;
    }
    .link-btn:hover {
      background: #0369a1;
      color: #fff;
    }
    footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--card-border);
      color: var(--text-muted);
      font-size: 0.8rem;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-top">
        <div>
          <h1>👻 GhostDeps Security Report</h1>
          <div class="header-meta">
            <span>Proyecto: <strong>${projectTitle}</strong></span> ·
            <span>Generado el ${isoDate}</span> ·
            <span>v${escapeHtml(meta.version)}</span>
          </div>
        </div>
      </div>
    </header>

    <div class="summary-grid">
      <div class="card card-total">
        <div class="card-title">Total analizadas</div>
        <div class="card-value">${summary.total}</div>
      </div>
      <div class="card card-crit">
        <div class="card-title">Crítico / Fantasma</div>
        <div class="card-value">${summary.critical}</div>
      </div>
      <div class="card card-caut">
        <div class="card-title">Precaución</div>
        <div class="card-value">${summary.caution}</div>
      </div>
      <div class="card card-good">
        <div class="card-title">Saludable</div>
        <div class="card-value">${summary.healthy}</div>
      </div>
    </div>

    <div class="controls-bar">
      <div class="filters">
        <button class="btn-filter active" onclick="setFilter('all')">Todas (${summary.total})</button>
        <button class="btn-filter" onclick="setFilter('critical')">🔴 Críticas (${summary.critical})</button>
        <button class="btn-filter" onclick="setFilter('caution')">🟡 Precaución (${summary.caution})</button>
        <button class="btn-filter" onclick="setFilter('healthy')">🟢 Saludables (${summary.healthy})</button>
        <button class="btn-filter" onclick="setFilter('scripts')">⚠️ Install Scripts</button>
      </div>
      <div class="search-box">
        <input type="text" id="searchInput" class="search-input" placeholder="Buscar dependencia o alerta..." oninput="handleSearch()">
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th class="text-center" style="width: 40px;"></th>
            <th>Paquete</th>
            <th class="text-center" style="width: 80px;">Score</th>
            <th class="text-center" style="width: 90px;">Últ. commit</th>
            <th class="text-center" style="width: 80px;">Mant.</th>
            <th>Alerta principal</th>
          </tr>
        </thead>
        <tbody id="reportTableBody">
          ${rowsHtml}
        </tbody>
      </table>
    </div>

    <footer>
      <div>Umbrales: 🟢 ≥ ${t.healthy} · 🟡 ${t.caution}–${t.healthy - 1} · 🔴 &lt; ${t.caution}</div>
      <div>Desarrollado con GhostDeps por @efraindrummer</div>
    </footer>
  </div>

  <script>
    let currentFilter = 'all';

    function toggleDetails(idx) {
      const el = document.getElementById('details-' + idx);
      if (!el) return;
      el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
    }

    function setFilter(filter) {
      currentFilter = filter;
      document.querySelectorAll('.btn-filter').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
      applyFilters();
    }

    function handleSearch() {
      applyFilters();
    }

    function applyFilters() {
      const q = (document.getElementById('searchInput').value || '').toLowerCase().trim();
      const rows = document.querySelectorAll('tr.report-row');

      rows.forEach(row => {
        const idx = row.getAttribute('data-index');
        const detailsRow = document.getElementById('details-' + idx);
        let matchFilter = true;

        if (currentFilter === 'critical') matchFilter = row.classList.contains('cat-critical');
        else if (currentFilter === 'caution') matchFilter = row.classList.contains('cat-caution');
        else if (currentFilter === 'healthy') matchFilter = row.classList.contains('cat-healthy');
        else if (currentFilter === 'scripts') matchFilter = row.classList.contains('has-scripts');

        let matchSearch = true;
        if (q) {
          const text = row.innerText.toLowerCase();
          matchSearch = text.includes(q);
        }

        if (matchFilter && matchSearch) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
          if (detailsRow) detailsRow.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>
`;
}
