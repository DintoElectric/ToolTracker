// js/screens/report.js
// 2d + 4e — Admin: monthly report. Cross-job summary, outstanding list, and
// the provenance table that distinguishes how each tool was closed. CSV +
// print carry the How/Note columns through.

import { api } from '../api.js';
import { el, mount, centerNote } from '../ui.js';
import { adminShell } from './jobs.js';

export function screenReport(ctx) {
  mount(adminShell('reports', centerNote('Loading…')));
  load(ctx);
}

async function load(ctx) {
  const month = ctx.query.month || '';
  const job = ctx.query.job || 'all';
  let data;
  try {
    data = await api.report(month, job);
  } catch (e) {
    return mount(adminShell('reports', centerNote('Couldn’t load the report', e.message)));
  }
  render(data, ctx);
}

function render(d, ctx) {
  const subline =
    `${d.totals.present} of ${d.totals.tools} tools marked present · ${d.daysLeft} ${d.daysLeft === 1 ? 'day' : 'days'} left in the cycle`;

  const head = el('div', { class: 'page-head', data: { noprint: '' } },
    el('div', {},
      el('h1', { class: 'page-title', text: d.monthLabel }),
      el('div', { class: 'page-subline', text: subline }),
    ),
  );

  mount(adminShell('reports',
    head,
    filters(d, ctx),
    printableTitle(d),
    summaryTable(d),
    outstandingTable(d),
    provenanceTable(d),
  ));
}

/* ── filters ─────────────────────────────────────────────────────── */
function filters(d, ctx) {
  const month = el('input', { class: 'input', type: 'month', value: d.period });
  const job = el('select', { class: 'input' },
    el('option', { value: 'all', text: 'All jobs', ...(d.scope === 'All jobs' ? { selected: 'selected' } : {}) }),
    ...d.jobs.map((j) => el('option', {
      value: j.id, text: j.name, ...(d.scope === j.name ? { selected: 'selected' } : {}),
    })),
  );
  const go = () => ctx.navigate(`/admin/reports?month=${month.value}&job=${job.value}`);
  month.addEventListener('change', go);
  job.addEventListener('change', go);

  return el('div', { class: 'report-filters', data: { noprint: '' } },
    labeled('Month', month),
    labeled('Job', job),
    el('div', { class: 'actions' },
      el('button', { class: 'btn btn-secondary', type: 'button', text: 'Export CSV', onClick: () => exportCsv(d) }),
      el('button', { class: 'btn btn-primary', type: 'button', text: 'Print report', onClick: () => printReport() }),
    ),
  );
}

// Title shown only on the printed page (screen has the big header above).
function printableTitle(d) {
  return el('div', { style: { display: 'none' }, data: { printtitle: '' } },
    el('h1', { style: { fontSize: '20px', margin: '0 0 4px' }, text: `${d.monthLabel} — Tool Register` }),
    el('div', { style: { fontSize: '12px' }, text: d.scope }),
  );
}

/* ── per-job summary ─────────────────────────────────────────────── */
function summaryTable(d) {
  const rows = d.summary.map((s) => el('tr', {},
    el('td', { class: 'name', data: { label: 'Job' }, text: s.name }),
    el('td', { data: { label: 'Foreman' }, text: s.foreman || '—' }),
    el('td', { class: 'num', data: { label: 'Tools' }, text: String(s.tools) }),
    el('td', { class: 'num', data: { label: 'Present' }, text: String(s.present) }),
    el('td', { class: `num${s.outstanding === 0 ? ' zero' : ''}`, data: { label: 'Outstanding' }, text: String(s.outstanding) }),
    el('td', { data: { label: 'Progress' } }, miniProgress(s.pct)),
  ));

  return card(
    table('Per-job summary',
      ['Job', 'Foreman', 'Tools', 'Present', 'Outstanding', 'Progress'],
      rows.length ? rows : [emptyRow(6, 'No active jobs yet.')]),
  );
}

/* ── outstanding across jobs ─────────────────────────────────────── */
function outstandingTable(d) {
  const rows = d.outstanding.map((o) => el('tr', {},
    el('td', { class: 'mono', data: { label: 'Tag' }, text: o.tag }),
    el('td', { class: 'name', data: { label: 'Tool' }, text: o.name }),
    el('td', { data: { label: 'Job' }, text: o.jobName }),
    el('td', { class: o.stale ? 'stale' : '', data: { label: 'Last marked' }, text: o.lastMarked }),
  ));
  return card(
    table(`Outstanding across all jobs — ${d.outstanding.length}`,
      ['Tag', 'Tool', 'Job', 'Last marked'],
      rows.length ? rows : [emptyRow(4, 'Nothing outstanding — every tool is accounted for.')]),
    { marginTop: '16px' },
  );
}

/* ── provenance (4e) — how each tool was closed ──────────────────── */
function provenanceTable(d) {
  const rows = d.provenance.map((p) => {
    const tr = el('tr', { class: p.retired ? 'is-retired' : (p.open ? 'is-open' : '') },
      el('td', { class: 'mono', data: { label: 'Tag' }, text: p.tag }),
      el('td', { class: 'name', data: { label: 'Tool' }, text: p.name }),
      el('td', { data: { label: 'Job' }, text: p.jobName }),
      el('td', { class: `closed${p.open ? '' : ''}`, data: { label: 'Closed' }, text: p.closed }),
      el('td', { data: { label: 'How' } }, howTag(p)),
      el('td', { class: 'note', data: { label: 'Note' }, text: p.note || '—' }),
    );
    return tr;
  });
  return card(
    table('How each tool was closed',
      ['Tag', 'Tool', 'Job', 'Closed', 'How', 'Note'],
      rows.length ? rows : [emptyRow(6, 'No tools in scope for this month.')]),
    { marginTop: '16px' },
  );
}

// Scan → neutral tag, Transfer → accent, Audited/Retired → outline, Open → —.
function howTag(p) {
  if (p.open) return el('span', { style: { color: 'var(--color-neutral-600)' }, text: '—' });
  const map = {
    scan:     ['tag-neutral', 'Scan'],
    transfer: ['tag-accent', 'Transfer'],
    audit:    ['tag-outline', 'Audited'],
    retired:  ['tag-outline', 'Retired'],
  };
  const [cls, label] = map[p.how] || ['tag-neutral', p.how || '—'];
  return el('span', { class: `tag ${cls}`, text: label });
}

/* ── CSV export (carries How + Note) ─────────────────────────────── */
function exportCsv(d) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Tag', 'Tool', 'Job', 'Closed', 'How', 'Note'].map(q).join(',')];
  for (const p of d.provenance) {
    const how = p.open ? 'Open'
      : ({ scan: 'Scan', transfer: 'Transfer', audit: 'Audited', retired: 'Retired' }[p.how] || p.how || '');
    lines.push([p.tag, p.name, p.jobName, p.open ? 'Open' : p.closed, how, p.note || ''].map(q).join(','));
  }
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `tool-register-${d.period}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printReport() {
  document.body.classList.add('printing-report');
  document.querySelectorAll('[data-printtitle]').forEach((n) => { n.style.display = 'block'; });
  const cleanup = () => {
    document.body.classList.remove('printing-report');
    document.querySelectorAll('[data-printtitle]').forEach((n) => { n.style.display = 'none'; });
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

/* ── small table helpers ─────────────────────────────────────────── */
function table(caption, headers, rows) {
  return el('table', { class: 'rtable' },
    el('caption', { text: caption }),
    el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', { text: h })))),
    el('tbody', {}, ...rows),
  );
}
function card(inner, extraStyle = {}) {
  return el('div', { class: 'card gt-wrap', style: { padding: '0', ...extraStyle } }, inner);
}
function emptyRow(span, text) {
  return el('tr', {}, el('td', { colspan: String(span), style: { color: 'var(--color-neutral-500)' }, text }));
}
function miniProgress(pct) {
  return el('div', { class: 'mini-progress' },
    el('div', { class: 'mini-track' }, el('div', { class: 'mini-fill', style: { width: `${pct}%` } })),
    el('span', { class: 'num', style: { fontSize: '12px' }, text: `${pct}%` }),
  );
}
function labeled(labelText, control) {
  return el('label', { class: 'field' },
    el('span', {
      style: {
        display: 'block', fontSize: '12px', marginBottom: '5px',
        color: 'color-mix(in srgb, var(--color-text) 70%, transparent)',
      },
      text: labelText,
    }),
    control,
  );
}
