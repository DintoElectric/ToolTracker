// js/screens/labels.js
// 3c — Admin: print label sheet. A label is the QR + the number, nothing
// else. Real QR codes (ECC level M, full scan URL), SVG for crisp print.
// Printing marks those tools' labels as printed.

import { api } from '../api.js';
import { scanUrl } from '../config.js';
import { el, mount, centerNote } from '../ui.js';
import { adminShell } from './jobs.js';

// Rendered QR size on screen (px). Print size is driven by the stock choice.
const QR_PX = 86;

export function screenLabels(ctx) {
  mount(adminShell('jobs', centerNote('Loading…')));
  load(ctx);
}

async function load(ctx) {
  const { jobId } = ctx.params;
  let data;
  try {
    data = await api.getJob(jobId);
  } catch (e) {
    const msg = e.status === 404 ? 'That job doesn’t exist.' : e.message;
    return mount(adminShell('jobs', centerNote('Couldn’t load labels', msg)));
  }
  render(data, ctx);
}

function render(data, ctx) {
  const { job } = data;
  const tools = [...data.tools].sort((a, b) => a.tag - b.tag);

  // Controls state.
  const state = { size: '2', scope: 'all' };

  const crumb = el('div', { class: 'crumb' },
    el('a', { href: '/admin/jobs', 'data-link': '' }, 'Jobs'),
    ' · ',
    el('a', { href: `/admin/jobs/${job.id}`, 'data-link': '' }, job.name),
    ' · Labels',
  );

  const head = el('div', { class: 'page-head' },
    el('div', {},
      el('h1', { class: 'page-title sub', text: `Print labels — ${job.name}` }),
      el('div', { class: 'page-subline' },
        `${tools.length} ${tools.length === 1 ? 'label' : 'labels'} · 2″ × 2″ weatherproof vinyl, 12 to a sheet`),
    ),
    el('div', { class: 'actions', data: { noprint: '' } },
      el('button', { class: 'btn btn-secondary', type: 'button', text: 'Download PDF',
        disabled: tools.length ? undefined : 'disabled', onClick: () => doPrint() }),
      el('button', { class: 'btn btn-primary', type: 'button', text: 'Print',
        disabled: tools.length ? undefined : 'disabled', onClick: () => doPrint() }),
    ),
  );

  // ── controls ──
  const sizeSeg = segmented('Label size', [['2', '2″'], ['1.5', '1.5″'], ['3', '3″']], state.size,
    (v) => { state.size = v; applySize(); });
  const scopeSeg = segmented('Print', [['all', 'All ' + tools.length], ['new', 'New only']], state.scope,
    (v) => { state.scope = v; renderSheet(); });
  const controls = el('div', { class: 'label-controls', data: { noprint: '' } }, sizeSeg, scopeSeg);

  // ── sheet ──
  const sheet = el('div', { class: 'sheet' });
  const printArea = el('div', { class: 'print-area' }, sheet);

  function shownTools() {
    return state.scope === 'new' ? tools.filter((t) => !t.labelPrinted) : tools;
  }

  function renderSheet() {
    sheet.replaceChildren();
    const list = shownTools();
    if (!list.length) {
      sheet.appendChild(el('div', { class: 'sheet-empty',
        text: state.scope === 'new' ? 'No new labels — every tool here is already printed.' : 'No tools on this job yet.' }));
      return;
    }
    for (const t of list) sheet.appendChild(labelCell(t));
  }

  function applySize() {
    // Drives the print grid/cell size via a CSS var (inches).
    sheet.style.setProperty('--label-in', state.size);
  }

  async function doPrint() {
    const list = shownTools();
    if (!list.length) return;
    applySize();
    document.body.classList.add('printing-labels');

    const cleanup = () => {
      document.body.classList.remove('printing-labels');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();

    // Record these as printed, then refresh so tags flip Not printed → Printed.
    try {
      await api.markLabelsPrinted(list.map((t) => t.id));
      load(ctx);
    } catch { /* non-fatal: the print already happened */ }
  }

  applySize();
  renderSheet();
  mount(adminShell('jobs', crumb, head, controls, printArea));
}

/* ── a single label: QR + big number ─────────────────────────────── */
function labelCell(tool) {
  return el('div', { class: 'label-cell' }, qrSvg(scanUrl(tool.scanToken)), el('div', { class: 'label-num', text: tool.tagDisplay }));
}

// Build an SVG QR for a payload. ECC 'M', quiet zone 4 modules.
function qrSvg(text) {
  const qr = window.qrcode(0, 'M');     // type 0 = auto-fit version
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const margin = 4;                     // quiet zone in modules
  const dim = count + margin * 2;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`);
  svg.setAttribute('width', QR_PX);
  svg.setAttribute('height', QR_PX);
  svg.setAttribute('shape-rendering', 'crispEdges');

  // Paper background (neutral-100) then ink modules (#161826).
  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('width', dim); bg.setAttribute('height', dim); bg.setAttribute('fill', '#f3f5fe');
  svg.appendChild(bg);

  // Merge each row's dark modules into one path for a compact, crisp render.
  let d = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#161826');
  svg.appendChild(path);
  return svg;
}

/* ── labelled segmented control ──────────────────────────────────── */
function segmented(labelText, options, initial, onChange) {
  const name = `seg-${Math.random().toString(36).slice(2, 8)}`;
  const seg = el('div', { class: 'seg' });
  for (const [value, label] of options) {
    const input = el('input', { type: 'radio', name, value, ...(value === initial ? { checked: 'checked' } : {}) });
    input.addEventListener('change', () => onChange(value));
    seg.appendChild(el('label', { class: 'seg-opt' }, input, el('span', { text: label })));
  }
  return el('div', {},
    el('span', { class: 'card-kicker ctl-label', text: labelText }),
    seg,
  );
}
