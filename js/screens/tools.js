// js/screens/tools.js
// 3b — Admin: tools on a job (+ 4a row menu). Register tools (minting their
// tags), see label status, and open the per-tool actions: transfer, audit,
// reprint, retire.

import { api } from '../api.js';
import { el, mount, busy, centerNote, openMenu } from '../ui.js';
import { adminShell, fieldWrap } from './jobs.js';
import { openTransferDialog, openAuditDialog, openRetireDialog } from './dialogs.js';

export function screenTools(ctx) {
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
    return mount(adminShell('jobs', centerNote('Couldn’t load the job', msg)));
  }
  render(data, ctx);
}

function render(data, ctx) {
  const { job, tools, nextTagDisplay, labelsPrinted } = data;
  const reload = () => load(ctx);

  const allPrinted = tools.length > 0 && labelsPrinted === tools.length;
  const labelSummary = tools.length === 0
    ? 'no tools yet'
    : allPrinted ? 'all labels printed'
    : `${labelsPrinted} of ${tools.length} labels printed`;

  const crumb = el('div', { class: 'crumb' },
    el('a', { href: '/admin/jobs', 'data-link': '' }, 'Jobs'),
    ' · ', job.name,
  );

  const head = el('div', { class: 'page-head' },
    el('div', {},
      el('h1', { class: 'page-title', text: job.name }),
      el('div', { class: 'page-subline' },
        `${job.foreman ? `${job.foreman}, foreman · ` : ''}${tools.length} ${tools.length === 1 ? 'tool' : 'tools'} · ${labelSummary}`),
    ),
    el('div', { class: 'actions' },
      el('button', {
        class: 'btn btn-secondary', type: 'button', text: 'Reprint one',
        disabled: tools.length ? undefined : 'disabled',
        onClick: () => ctx.navigate(`/admin/jobs/${job.id}/labels`),
      }),
      el('button', {
        class: 'btn btn-primary', type: 'button',
        text: tools.length ? `Print all ${tools.length}` : 'Print labels',
        disabled: tools.length ? undefined : 'disabled',
        onClick: () => ctx.navigate(`/admin/jobs/${job.id}/labels`),
      }),
    ),
  );

  mount(adminShell('jobs',
    crumb, head,
    toolsTable(tools, job, ctx, reload),
    addToolCard(job, nextTagDisplay, ctx, reload),
  ));
}

function toolsTable(tools, job, ctx, reload) {
  const cols = { '--cols': '.6fr 2.4fr 1.1fr 1fr .5fr' };
  const wrap = el('div', { class: 'card gt gt-wrap', style: cols });

  wrap.appendChild(el('div', { class: 'gt-head' },
    el('span', {}, 'Tag'), el('span', {}, 'Tool'),
    el('span', {}, 'Added'), el('span', {}, 'Label'), el('span', {}),
  ));

  if (!tools.length) {
    wrap.appendChild(el('div', { class: 'gt-row', style: { gridTemplateColumns: '1fr' } },
      el('span', {
        style: { color: 'var(--color-neutral-500)' },
        text: 'No tools on this job yet. Add one below to mint its tag.',
      })));
    return wrap;
  }

  for (const t of tools) {
    const menuAnchor = el('div', { class: 'gt-actions' });
    const dots = el('button', {
      class: 'dots', type: 'button', title: 'Actions', 'aria-label': `Actions for tag ${t.tagDisplay}`,
      text: '⋯',
      onClick: () => openMenu(menuAnchor, rowMenuItems(t, job, ctx, reload)),
    });
    menuAnchor.appendChild(dots);

    wrap.appendChild(el('div', { class: 'gt-row', style: { cursor: 'default' } },
      el('span', {
        class: `gt-mono${t.labelPrinted ? '' : ' unprinted'}`,
        data: { label: 'Tag' }, text: t.tagDisplay,
      }),
      el('span', { class: 'gt-name', data: { label: 'Tool' }, text: t.name }),
      el('span', { data: { label: 'Added' }, text: t.added }),
      el('span', { data: { label: 'Label' } },
        el('span', {
          class: `tag ${t.labelPrinted ? 'tag-neutral' : 'tag-accent'}`,
          text: t.labelPrinted ? 'Printed' : 'Not printed',
        })),
      menuAnchor,
    ));
  }
  return wrap;
}

// 4a — the three actions (+ reprint). Retire sits below a divider as the
// destructive action.
function rowMenuItems(tool, job, ctx, reload) {
  return [
    { label: 'Transfer to another job', onClick: () => openTransferDialog(tool, job, reload) },
    { label: 'Mark present by audit', onClick: () => openAuditDialog(tool, job, reload) },
    { label: 'Reprint label', onClick: () => ctx.navigate(`/admin/jobs/${job.id}/labels`) },
    { label: 'Retire tool', destructive: true, sepBefore: true, onClick: () => openRetireDialog(tool, job, reload) },
  ];
}

function addToolCard(job, nextTagDisplay, ctx, reload) {
  const name = el('input', { class: 'input', placeholder: 'e.g. Greenlee 555 conduit bender' });
  const qty = el('input', { class: 'input tnum', type: 'number', min: '1', max: '100', value: '1' });
  const nextOut = el('span', { class: 'next-tag' }, 'Next tag ', el('b', { text: nextTagDisplay }));
  const errLine = el('div', { class: 'err-line', hidden: 'hidden' });

  const submit = el('button', { class: 'btn btn-primary', type: 'button', text: 'Add' });
  const add = async () => {
    errLine.hidden = true;
    if (!name.value.trim()) { name.focus(); return; }
    busy(submit, true, 'Adding…');
    try {
      const res = await api.addTools(job.id, name.value.trim(), parseInt(qty.value, 10) || 1);
      name.value = ''; qty.value = '1';
      nextOut.querySelector('b').textContent = res.nextTagDisplay; // advance preview
      reload();               // refresh the table
      setTimeout(() => name.focus(), 0);
    } catch (e) {
      busy(submit, false);
      errLine.textContent = e.message;
      errLine.hidden = false;
    }
  };
  submit.addEventListener('click', add);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  return el('div', { class: 'card entry-card' },
    el('div', { class: 'card-kicker', text: 'Add a tool' }),
    el('div', { class: 'entry-row' },
      fieldWrap('Tool name', name, 'grow2'),
      fieldWrap('Quantity', qty, 'narrow'),
      nextOut,
      submit,
    ),
    el('div', { class: 'help',
      text: 'Adding two of the same tool creates two tags. Numbers are never reused, even after a tool is retired.' }),
    errLine,
  );
}
