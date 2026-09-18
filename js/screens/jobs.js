// js/screens/jobs.js
// 3a — Admin: jobs. See every active job with its tool and label counts,
// and create new ones. Also exports adminNav() + adminShell(), reused by
// the other admin screens.

import { api } from '../api.js';
import { CONFIG } from '../config.js';
import { el, mount, busy, centerNote } from '../ui.js';

/* ── shared admin chrome ─────────────────────────────────────────── */
export function adminNav(current) {
  const link = (href, label, key) =>
    el('a', { href, 'data-link': '', ...(current === key ? { 'aria-current': 'page' } : {}) }, label);
  return el('nav', { class: 'nav' },
    el('a', {
      class: 'nav-brand', href: '/admin/jobs', 'data-link': '',
      style: { color: 'inherit', textDecoration: 'none' },
    }, CONFIG.BRAND),
    link('/admin/jobs', 'Jobs', 'jobs'),
    link('/admin/reports', 'Reports', 'reports'),
    el('span', { class: 'nav-user' }, `${CONFIG.ADMIN_NAME} · ${CONFIG.ADMIN_ROLE}`),
  );
}

// Wrap a page body in the admin frame (nav + centred body).
export function adminShell(current, ...body) {
  return el('div', { class: 'admin' },
    adminNav(current),
    el('div', { class: 'admin-body' }, ...body),
  );
}

// Small labelled-field helper (label + control), matching .field markup.
export function fieldWrap(label, control, extra = '') {
  return el('label', { class: `field ${extra}`.trim() },
    el('span', {
      style: {
        display: 'block', fontSize: '12px', marginBottom: '5px',
        color: 'color-mix(in srgb, var(--color-text) 70%, transparent)',
      },
      text: label,
    }),
    control,
  );
}

/* ── screen ──────────────────────────────────────────────────────── */
export function screenJobs(ctx) {
  mount(adminShell('jobs', centerNote('Loading…')));
  load(ctx);
}

async function load(ctx) {
  let data;
  try {
    data = await api.listJobs();
  } catch (e) {
    return mount(adminShell('jobs', centerNote('Couldn’t load jobs', e.message)));
  }
  render(data, ctx);
}

function render(data, ctx) {
  const t = data.totals;
  const subline =
    `${t.activeJobs} active · ${t.tools} ${t.tools === 1 ? 'tool' : 'tools'} · ${t.labelsPrinted} labels printed`;

  const head = el('div', { class: 'page-head' },
    el('div', {},
      el('h1', { class: 'page-title', text: 'Jobs' }),
      el('div', { class: 'page-subline', text: subline }),
    ),
    el('div', { class: 'spacer' }),
    el('button', {
      class: 'btn btn-primary', type: 'button', text: 'New job',
      onClick: () => focusNewJob(),
    }),
  );

  mount(adminShell('jobs', head, jobsTable(data.jobs), newJobCard(ctx)));
}

function jobsTable(jobs) {
  const cols = { '--cols': '2fr 1.2fr .8fr 1.1fr .9fr' };
  const wrap = el('div', { class: 'card gt gt-wrap', style: cols });

  wrap.appendChild(el('div', { class: 'gt-head' },
    el('span', {}, 'Job'), el('span', {}, 'Foreman'),
    el('span', {}, 'Tools'), el('span', {}, 'Labels printed'), el('span', {}),
  ));

  if (!jobs.length) {
    wrap.appendChild(el('div', { class: 'gt-row', style: { gridTemplateColumns: '1fr' } },
      el('span', {
        style: { color: 'var(--color-neutral-500)' },
        text: 'No jobs yet. Create your first job below.',
      })));
    return wrap;
  }

  for (const j of jobs) {
    wrap.appendChild(el('a', { class: 'gt-row', href: `/admin/jobs/${j.id}`, 'data-link': '' },
      el('span', { class: 'gt-name', data: { label: 'Job' }, text: j.name }),
      el('span', { data: { label: 'Foreman' }, text: j.foreman || '—' }),
      el('span', { class: 'gt-num', data: { label: 'Tools' }, text: String(j.tools) }),
      el('span', { class: 'gt-num', data: { label: 'Labels' }, text: String(j.labelsPrinted) }),
      el('span', { class: 'gt-link', text: 'Open' }),
    ));
  }
  return wrap;
}

function newJobCard(ctx) {
  const name = el('input', { class: 'input', id: 'nj-name', placeholder: 'e.g. Fairview Medical Fit-out' });
  const foreman = el('input', { class: 'input', id: 'nj-foreman', placeholder: 'Assign a foreman' });
  const errLine = el('div', { class: 'err-line', hidden: 'hidden' });

  const submit = el('button', { class: 'btn btn-primary', type: 'button', text: 'Create job' });
  const create = async () => {
    errLine.hidden = true;
    if (!name.value.trim()) { name.focus(); return; }
    busy(submit, true, 'Creating…');
    try {
      await api.createJob(name.value.trim(), foreman.value.trim());
      load(ctx); // refresh the list + totals
    } catch (e) {
      busy(submit, false);
      errLine.textContent = e.message;
      errLine.hidden = false;
    }
  };
  submit.addEventListener('click', create);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') foreman.focus(); });
  foreman.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });

  return el('div', { class: 'card entry-card' },
    el('div', { class: 'card-kicker', text: 'New job' }),
    el('div', { class: 'entry-row' },
      fieldWrap('Job name', name, 'grow2'),
      fieldWrap('Foreman', foreman, ''),
      submit,
    ),
    errLine,
  );
}

function focusNewJob() {
  const n = document.getElementById('nj-name');
  if (n) { n.scrollIntoView({ behavior: 'smooth', block: 'center' }); n.focus(); }
}
