// js/screens/scan.js
// Mobile scan landing: 2a (open), 2c (already confirmed), and the retired
// terminal state. One tool, one decision, one button. The tool is resolved
// from the URL token by the server; this screen never sends a tool id.

import { api } from '../api.js';
import { el, mount, icon, busy, centerNote } from '../ui.js';

export function screenScan(ctx) {
  const { token } = ctx.params;
  mount(centerNote('Loading…'));

  api.scanState(token).then((data) => {
    if (data.state === 'retired') return mount(retiredView(data));
    if (data.state === 'confirmed') return mount(confirmedView(data, ctx));
    return mount(openView(data, token, ctx));
  }).catch((err) => {
    // Unknown tag or a load failure — a clear terminal state, not a 404 page.
    mount(unknownView(err));
  });
}

/* ── 2a — not yet confirmed ──────────────────────────────────────── */
function openView(d, token, ctx) {
  const btn = el('button', {
    class: 'btn btn-primary btn-block btn-confirm',
    type: 'button',
    text: "Yes — it's here",
  });
  const errLine = el('div', { class: 'err-line', hidden: 'hidden' });

  btn.addEventListener('click', async () => {
    errLine.hidden = true;
    busy(btn, true, 'Recording…');
    try {
      const res = await api.confirmScan(token);
      // Straight to the month list; pass the tag so 2b shows its banner once.
      ctx.navigate(`/jobs/${res.jobId}/month?confirmed=${res.tag}`);
    } catch (e) {
      busy(btn, false);
      errLine.textContent = `${e.message} Tap to try again.`;
      errLine.hidden = false;
    }
  });

  return el('div', { class: 'scan' },
    el('div', { class: 'scan-eyebrow', text: `TAG ${d.tag}` }),
    el('h1', { class: 'scan-tool', text: d.tool }),
    d.job ? el('div', { class: 'scan-job', text: d.job.name }) : null,

    el('div', { class: 'scan-block' },
      el('div', { class: 'scan-q', text: 'Is this tool here right now?' }),
      el('div', { class: 'scan-sub', text: `${d.month} has not been recorded for this tool.` }),
    ),

    btn,
    errLine,

    el('div', { class: 'scan-footnote' },
      `This code only records tag ${d.tag}. Every other tool needs its own scan.`),
  );
}

/* ── 2c — already confirmed this month ───────────────────────────── */
function confirmedView(d, ctx) {
  const c = d.confirmation || {};
  const sub = `${c.at || ''}${c.by ? ` by ${c.by}` : ''}. Nothing more to do until ${d.unlocks}.`;

  // Disabled-in-place button — kept visible so the page reads as the same
  // page, just spent.
  const spent = el('button', {
    class: 'btn btn-primary btn-block btn-confirm is-spent',
    type: 'button', 'aria-disabled': 'true', tabindex: '-1',
    text: "Yes — it's here",
  });

  const seeList = el('button', {
    class: 'btn btn-secondary btn-block btn-see', type: 'button',
    text: "See the month's list",
    onClick: () => d.job && ctx.navigate(`/jobs/${d.job.id}/month`),
  });

  return el('div', { class: 'scan' },
    el('div', { class: 'scan-eyebrow', text: `TAG ${d.tag}` }),
    el('h1', { class: 'scan-tool', text: d.tool }),
    d.job ? el('div', { class: 'scan-job', text: d.job.name }) : null,

    el('div', { class: 'scan-confirmed' },
      icon('check'),
      el('div', {},
        el('div', { class: 'scan-confirmed-h', text: `Marked present for ${d.month}` }),
        el('div', { class: 'scan-sub', style: { marginTop: '6px' }, text: sub }),
      ),
    ),

    spent,
    seeList,

    el('div', { class: 'scan-footnote' },
      'The button unlocks again on the first of next month.'),
  );
}

/* ── retired terminal state ──────────────────────────────────────── */
function retiredView(d) {
  return el('div', { class: 'scan' },
    el('div', { class: 'scan-eyebrow', text: `TAG ${d.tag}` }),
    el('h1', { class: 'scan-tool', text: d.tool }),
    el('div', { class: 'scan-terminal' },
      el('div', { class: 'scan-q', text: 'This tool has been retired.' }),
      el('div', { class: 'scan-sub', text: 'It is no longer tracked. Nothing to confirm.' }),
    ),
    el('div', { class: 'scan-footnote' },
      `Tag ${d.tag} is out of service and will not be reused.`),
  );
}

/* ── unknown tag / load error ────────────────────────────────────── */
function unknownView(err) {
  const is404 = err && err.status === 404;
  return el('div', { class: 'scan' },
    el('div', { class: 'scan-terminal', style: { borderTop: 'none', marginTop: '20px' } },
      el('div', { class: 'scan-q', text: is404 ? 'Tag not recognised' : 'Couldn’t load this tag' }),
      el('div', { class: 'scan-sub', text: is404
        ? 'This code isn’t registered to a tool. Check with the office.'
        : `${err.message} Reload the page to try again.` }),
    ),
  );
}
