// js/screens/month.js
// 2b — Month status list. Immediate feedback after a scan plus what's still
// outstanding on the job this month. Rows are NOT interactive: the only way
// to confirm a tool is to scan its own QR.

import { api } from '../api.js';
import { el, mount, icon, centerNote } from '../ui.js';

export function screenMonth(ctx) {
  const { jobId } = ctx.params;
  const justTag = ctx.query.confirmed || null;

  // Show the banner once: strip ?confirmed from the URL so a refresh or a
  // back-nav doesn't resurface it.
  if (justTag) {
    history.replaceState({}, '', `/jobs/${jobId}/month`);
  }

  mount(centerNote('Loading…'));

  api.monthList(jobId)
    .then((d) => mount(view(d, justTag, ctx)))
    .catch((e) => mount(centerNote('Couldn’t load the list', e.message)));
}

function view(d, justTag, ctx) {
  const pct = d.total ? Math.round((d.present / d.total) * 100) : 0;

  const header = el('div', { class: 'month-inset' },
    el('h1', { class: 'month-h', text: d.month }),
    el('div', { class: 'month-subline' },
      `${d.job.name} · ${d.daysLeft} ${d.daysLeft === 1 ? 'day' : 'days'} left`),
    el('div', { class: 'progress' },
      el('div', { class: 'progress-track' },
        el('div', { class: 'progress-fill', style: { width: `${pct}%` } })),
      el('div', { class: 'progress-count', text: `${d.present}/${d.total}` }),
    ),
  );

  const banner = justTag
    ? el('div', { class: 'confirm-banner' }, icon('check'),
        el('span', { text: `Tag ${justTag} marked present` }))
    : null;

  return el('div', { class: 'month' },
    banner,
    header,
    outstandingSection(d.outstanding),
    presentSection(d.presentList),
  );
}

function outstandingSection(rows) {
  if (!rows.length) {
    return el('div', {},
      el('div', { class: 'section-label pad-top', text: 'Still outstanding — 0' }),
      el('div', { class: 'mrow' },
        el('div', { class: 'mrow-main' },
          el('div', { class: 'mrow-time', text: 'Everything on this job is marked present.' }))),
    );
  }
  return el('div', {},
    el('div', { class: 'section-label', text: `Still outstanding — ${rows.length}` }),
    ...rows.map((r) => el('div', { class: 'mrow' },
      el('div', { class: 'mrow-tag', text: r.tag }),
      el('div', { class: 'mrow-main' },
        el('div', { class: 'mrow-name', text: r.name }),
        r.missedPrior > 0 ? el('div', { class: 'mrow-warn', text: missedText(r) }) : null,
      ),
    )),
  );
}

function presentSection(rows) {
  if (!rows.length) return null;
  return el('div', {},
    el('div', { class: 'section-label pad-top', text: `Marked present — ${rows.length}` }),
    ...rows.map((r) => el('div', { class: 'mrow is-present' },
      el('div', { class: 'mrow-tag', text: r.tag }),
      el('div', { class: 'mrow-main' },
        el('div', { class: 'mrow-name', text: r.name }),
        el('div', { class: 'mrow-time', text: presentText(r) }),
      ),
      icon('check', 'icon mrow-check'),
    )),
  );
}

// "Missed August too" / "Missed the last 2 months".
function missedText(r) {
  if (r.missedPrior === 1 && r.lastMarked) {
    const [y, m] = r.lastMarked.split('-').map(Number);
    const missedMonth = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m, 1))); // month after lastMarked = the one it missed
    return `Missed ${missedMonth} too`;
  }
  return `Missed the last ${r.missedPrior} months`;
}

// "Just now" if within a couple minutes, else the server's short date.
function presentText(r) {
  if (r.source === 'audit') return `${r.at} · by audit`;
  if (r.source === 'transfer') return `${r.at} · moved`;
  if (r.atRaw && Date.now() - new Date(r.atRaw).getTime() < 120000) return 'Just now';
  return r.at || '';
}
