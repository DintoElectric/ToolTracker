// js/screens/dialogs.js
// 4b transfer · 4c audit · 4d retire. Each opens over 3b, validates, calls
// the API, and reloads on success. The consequence panels are the point of
// the transfer/retire dialogs — full weight, not fine print.

import { api } from '../api.js';
import { CONFIG } from '../config.js';
import { el, busy, openDialog, fmtLongDate, todayInputValue } from '../ui.js';

/* ── 4b — Transfer ───────────────────────────────────────────────── */
export function openTransferDialog(tool, job, reload) {
  openDialog(async (dialog, close) => {
    // Populate destinations (every active job except the current one).
    let jobs = [];
    try { jobs = (await api.listJobs()).jobs.filter((j) => j.id !== job.id); }
    catch { /* fall through — the select just renders empty */ }

    const select = el('select', { class: 'input' },
      el('option', { value: '', text: jobs.length ? 'Choose a job…' : 'No other jobs available' }),
      ...jobs.map((j) => el('option', { value: j.id, text: j.name })),
    );
    const dateField = el('input', { class: 'input', type: 'date', value: todayInputValue() });

    const consequence = el('div', { class: 'consequence' });
    const renderConsequence = () => {
      const dest = jobs.find((j) => j.id === select.value);
      const d = dateField.value ? new Date(`${dateField.value}T00:00:00`) : new Date();
      const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(d);
      const moveStr = fmtLongDate(d).replace(/, \d{4}$/, ''); // "Sep 18"
      if (!dest) {
        consequence.textContent = 'Choose a destination job to see what this move records.';
        return;
      }
      const last = lastOfMonth(d);
      consequence.replaceChildren(
        el('span', {}, `${moveStr} will be recorded as ${monthName}'s scan for `),
        el('strong', { text: job.name }),
        el('span', {}, `. The tool starts fresh on ${dest.name} and must be scanned there before ${last}.`),
      );
    };
    select.addEventListener('change', () => { renderConsequence(); syncPrimary(); });
    dateField.addEventListener('change', renderConsequence);
    renderConsequence();

    const errLine = el('div', { class: 'err-line', hidden: 'hidden' });
    const cancel = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onClick: close });
    const confirm = el('button', { class: 'btn btn-primary', type: 'button', text: 'Transfer tool' });
    const syncPrimary = () => { confirm.disabled = !select.value; };
    syncPrimary();

    confirm.addEventListener('click', async () => {
      if (!select.value) return;
      errLine.hidden = true;
      busy(confirm, true, 'Transferring…');
      try {
        await api.transfer(tool.id, select.value, new Date(`${dateField.value}T12:00:00`).toISOString());
        close(); reload();
      } catch (e) {
        busy(confirm, false);
        errLine.textContent = e.message; errLine.hidden = false;
      }
    });

    dialog.append(
      el('div', { class: 'dialog-title', text: `Transfer tag ${tool.tagDisplay}` }),
      el('div', { style: sub(), text: `${tool.name} · currently on ${job.name}` }),
      labeled('Move to', select),
      labeled('Date of move', dateField),
      consequence,
      errLine,
      el('div', { class: 'dialog-actions' }, cancel, confirm),
    );
  });
}

/* ── 4c — Audit (note required) ──────────────────────────────────── */
export function openAuditDialog(tool, job, reload) {
  openDialog((dialog, close) => {
    const note = el('textarea', { class: 'input', rows: '4', placeholder: '' });
    const errLine = el('div', { class: 'err-line', hidden: 'hidden' });

    const cancel = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onClick: close });
    const confirm = el('button', { class: 'btn btn-primary', type: 'button', text: 'Mark present', disabled: 'disabled' });

    // Primary disabled until the note is non-empty.
    note.addEventListener('input', () => { confirm.disabled = !note.value.trim(); });

    confirm.addEventListener('click', async () => {
      if (!note.value.trim()) return;
      errLine.hidden = true;
      busy(confirm, true, 'Recording…');
      try {
        await api.audit(tool.id, note.value.trim());
        close(); reload();
      } catch (e) {
        busy(confirm, false);
        errLine.textContent = e.message; errLine.hidden = false;
      }
    });

    // Attribution strip — plain neutral-800 hairline box.
    const attribution = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 12px', borderRadius: 'var(--radius-md)',
        boxShadow: 'inset 0 0 0 1px var(--color-neutral-800)',
      },
    },
      el('span', { class: 'tag tag-outline', text: 'Audited' }),
      el('span', {
        style: { fontSize: '12.5px', color: 'var(--color-neutral-400)' },
        text: `Recorded as ${CONFIG.ADMIN_NAME}, ${fmtLongDate(new Date())}`,
      }),
    );

    dialog.append(
      el('div', { class: 'dialog-title', text: `Mark tag ${tool.tagDisplay} present by audit` }),
      el('div', { style: sub(), text: `${tool.name} · ${job.name}` }),
      labeled('Why is this being closed without a scan?', note),
      el('div', {
        class: 'help',
        text: 'Required. This note appears on the tool’s history and in the monthly report.',
      }),
      attribution,
      errLine,
      el('div', { class: 'dialog-actions' }, cancel, confirm),
    );
  });
}

/* ── 4d — Retire (reason required) ───────────────────────────────── */
export function openRetireDialog(tool, job, reload) {
  openDialog((dialog, close) => {
    const reason = el('input', { class: 'input', placeholder: 'e.g. Written off — not recovered after two cycles' });
    const errLine = el('div', { class: 'err-line', hidden: 'hidden' });

    const cancel = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onClick: close });
    const confirm = el('button', { class: 'btn btn-primary', type: 'button', text: 'Retire tool', disabled: 'disabled' });
    reason.addEventListener('input', () => { confirm.disabled = !reason.value.trim(); });

    confirm.addEventListener('click', async () => {
      if (!reason.value.trim()) return;
      errLine.hidden = true;
      busy(confirm, true, 'Retiring…');
      try {
        await api.retire(tool.id, reason.value.trim());
        close(); reload();
      } catch (e) {
        busy(confirm, false);
        errLine.textContent = e.message; errLine.hidden = false;
      }
    });

    const consequence = el('div', { class: 'consequence' },
      el('span', {}, 'From today this tool leaves every count, outstanding list and report. It stops accruing missed months. Its history stays searchable and tag '),
      el('strong', { text: tool.tagDisplay }),
      el('span', {}, ' is never reused.'),
    );

    dialog.append(
      el('div', { class: 'dialog-title', text: `Retire tag ${tool.tagDisplay}` }),
      el('div', { style: sub(), text: `${tool.name} · ${job.name}` }),
      labeled('Reason', reason),
      consequence,
      errLine,
      el('div', { class: 'dialog-actions' }, cancel, confirm),
    );
  });
}

/* ── shared bits ─────────────────────────────────────────────────── */
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
const sub = () => ({ fontSize: '14px', color: 'var(--color-neutral-500)', marginTop: '-4px' });

// Last calendar day of a date's month, e.g. "Sep 30".
function lastOfMonth(d) {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(last);
}
