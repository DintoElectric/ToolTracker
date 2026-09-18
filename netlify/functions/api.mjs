// netlify/functions/api.mjs
// HTTP layer for the Dinto Tool Register — a single Functions v2 handler
// serving /api/*. Routing is by pathname; all state lives in store.mjs.
//
// Security-relevant rule (handoff): the confirm endpoint resolves the tool
// from the URL token ONLY. There is no tool id in any request body, and no
// bulk-confirm route. One token confirms exactly one tool.

import {
  TZ, store, currentPeriod, periodOf, daysLeftInPeriod, addMonths,
  newId, newToken, fmtTag,
  getJobs, getTools, getTransfers, saveJobs, saveTools, saveTransfers,
  peekNextTag, mintTags,
  putConfirmationIfNew, getConfirmation,
  listConfirmationsForPeriod, listConfirmationsForTool,
  findToolByToken, findToolById, findJobById,
  countsInPeriod, retiredInPeriod, toolHistory,
} from './store.mjs';

export const config = { path: '/api/*' };

/* ── response + parsing helpers ──────────────────────────────────── */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const err = (status, message) => json({ error: message }, status);

async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}

// Admin actions are attributed to this until real auth exists. The front-end
// sends its configured admin name; fall back to a neutral label.
const adminName = (body) => (body && body.by && String(body.by).trim()) || 'Office';

/* ── date/text formatting for responses ──────────────────────────── */

const monthLong = (period) => {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)));
};
const monthLongYear = (period) => {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)));
};
// "Sep 11" in the company timezone.
const fmtShort = (iso) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: TZ })
    .format(new Date(iso));
// "Mar 2023" — the "Added" column.
const fmtMonthYear = (iso) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: TZ })
    .format(new Date(iso));
// "October 1" — when the button unlocks again.
const firstOfNextMonth = (period) => {
  const [y, m] = addMonths(period, 1).split('-').map(Number);
  return `${new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)))} 1`;
};

const toolDTO = (t) => ({
  id: t.id,
  tag: t.tag,
  tagDisplay: fmtTag(t.tag),
  name: t.name,
  jobId: t.jobId,
  createdAt: t.createdAt,
  added: fmtMonthYear(t.createdAt),
  labelPrinted: !!t.labelPrintedAt,
  retired: !!t.retiredAt,
});

/* ── handler ─────────────────────────────────────────────────────── */

export default async function handler(req) {
  const url = new URL(req.url);
  const rest = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const seg = rest ? rest.split('/') : [];
  const m = req.method;

  try {
    // GET /api  → health check
    if (seg.length === 0) return json({ ok: true, service: 'tool-register' });

    // ── JOBS ────────────────────────────────────────────────────────
    if (seg[0] === 'jobs' && seg.length === 1) {
      if (m === 'GET') return listJobs();
      if (m === 'POST') return createJob(await readBody(req));
      return err(405, 'Method not allowed');
    }
    if (seg[0] === 'jobs' && seg.length === 2 && m === 'GET') {
      return getJob(seg[1]);
    }
    if (seg[0] === 'jobs' && seg.length === 3 && seg[2] === 'month' && m === 'GET') {
      return monthList(seg[1]);
    }

    // ── TOOLS ───────────────────────────────────────────────────────
    if (seg[0] === 'tools' && seg.length === 1 && m === 'POST') {
      return addTools(await readBody(req));
    }
    if (seg[0] === 'tools' && seg.length === 3 && m === 'POST') {
      const [, id, action] = seg;
      if (action === 'transfer') return transferTool(id, await readBody(req));
      if (action === 'retire')   return retireTool(id, await readBody(req));
      if (action === 'audit')    return auditTool(id, await readBody(req));
    }

    // ── LABELS ──────────────────────────────────────────────────────
    if (seg[0] === 'labels' && seg[1] === 'mark-printed' && m === 'POST') {
      return markLabelsPrinted(await readBody(req));
    }

    // ── SCAN (token-scoped, public) ─────────────────────────────────
    if (seg[0] === 'scan' && seg.length === 2 && m === 'GET') {
      return scanState(seg[1]);
    }
    if (seg[0] === 'scan' && seg.length === 3 && seg[2] === 'confirm' && m === 'POST') {
      return scanConfirm(seg[1]); // NOTE: token only. No body is read here.
    }

    // ── MISC ────────────────────────────────────────────────────────
    if (seg[0] === 'next-tag' && m === 'GET') {
      return json({ nextTag: await peekNextTag(), nextTagDisplay: fmtTag(await peekNextTag()) });
    }
    if (seg[0] === 'report' && m === 'GET') {
      return report(url.searchParams.get('month'), url.searchParams.get('job'));
    }

    return err(404, 'Not found');
  } catch (e) {
    return err(500, e?.message || 'Server error');
  }
}

/* ── job handlers ────────────────────────────────────────────────── */

async function listJobs() {
  const [jobs, tools] = await Promise.all([getJobs(), getTools()]);
  const live = tools.filter((t) => !t.retiredAt);
  const rows = jobs.filter((j) => j.active !== false).map((j) => {
    const ts = live.filter((t) => t.jobId === j.id);
    return {
      id: j.id, name: j.name, foreman: j.foreman || '',
      tools: ts.length,
      labelsPrinted: ts.filter((t) => t.labelPrintedAt).length,
    };
  });
  return json({
    jobs: rows,
    totals: {
      activeJobs: rows.length,
      tools: rows.reduce((n, r) => n + r.tools, 0),
      labelsPrinted: rows.reduce((n, r) => n + r.labelsPrinted, 0),
    },
  });
}

async function createJob(body) {
  const name = (body.name || '').trim();
  if (!name) return err(400, 'Job name is required');
  const jobs = await getJobs();
  const job = {
    id: newId(), name, foreman: (body.foreman || '').trim(),
    active: true, createdAt: new Date().toISOString(),
  };
  jobs.push(job);
  await saveJobs(jobs);
  return json({ job: { id: job.id, name: job.name, foreman: job.foreman } }, 201);
}

async function getJob(jobId) {
  const [jobs, tools, nextTag] = await Promise.all([getJobs(), getTools(), peekNextTag()]);
  const job = findJobById(jobs, jobId);
  if (!job) return err(404, 'Job not found');
  const ts = tools
    .filter((t) => t.jobId === jobId && !t.retiredAt)
    .sort((a, b) => a.tag - b.tag)
    .map(toolDTO);
  return json({
    job: { id: job.id, name: job.name, foreman: job.foreman || '' },
    tools: ts,
    nextTag, nextTagDisplay: fmtTag(nextTag),
    labelsPrinted: ts.filter((t) => t.labelPrinted).length,
  });
}

/* ── tool handlers ───────────────────────────────────────────────── */

async function addTools(body) {
  const name = (body.name || '').trim();
  const qty = Math.max(1, Math.min(100, parseInt(body.quantity, 10) || 1));
  const jobId = body.jobId;
  if (!name) return err(400, 'Tool name is required');

  const [jobs, tools] = await Promise.all([getJobs(), getTools()]);
  if (!findJobById(jobs, jobId)) return err(404, 'Job not found');

  const nums = await mintTags(qty); // reserves N sequential tags atomically
  const now = new Date().toISOString();
  const created = nums.map((tag) => ({
    id: newId(), tag, name, category: null, jobId,
    createdAt: now, labelPrintedAt: null, scanToken: newToken(),
    retiredAt: null, retiredBy: null, retireReason: null,
  }));
  tools.push(...created);
  await saveTools(tools);

  return json({
    created: created.map((t) => ({ ...toolDTO(t), scanToken: t.scanToken })),
    nextTag: await peekNextTag(),
    nextTagDisplay: fmtTag(await peekNextTag()),
  }, 201);
}

async function markLabelsPrinted(body) {
  const ids = Array.isArray(body.toolIds) ? body.toolIds : [];
  if (!ids.length) return err(400, 'No tools specified');
  const tools = await getTools();
  const now = new Date().toISOString();
  let changed = 0;
  for (const t of tools) {
    if (ids.includes(t.id) && !t.labelPrintedAt) { t.labelPrintedAt = now; changed += 1; }
  }
  if (changed) await saveTools(tools);
  return json({ marked: changed });
}

async function transferTool(toolId, body) {
  const toJobId = body.toJobId;
  const movedAt = body.movedAt ? new Date(body.movedAt).toISOString() : new Date().toISOString();
  const by = adminName(body);

  const [jobs, tools, transfers] = await Promise.all([getJobs(), getTools(), getTransfers()]);
  const tool = findToolById(tools, toolId);
  if (!tool) return err(404, 'Tool not found');
  if (tool.retiredAt) return err(409, 'Tool is retired');
  const toJob = findJobById(jobs, toJobId);
  if (!toJob) return err(404, 'Destination job not found');
  if (toJob.id === tool.jobId) return err(400, 'Tool is already on that job');

  const fromJobId = tool.jobId;
  const period = periodOf(movedAt);

  // The move stands in for the departing job's scan this period (source=transfer).
  await putConfirmationIfNew({
    id: newId(), toolId: tool.id, jobId: fromJobId, period,
    confirmedAt: movedAt, confirmedBy: by, source: 'transfer', note: null,
  });

  transfers.push({ id: newId(), toolId: tool.id, fromJob: fromJobId, toJob: toJobId, movedAt, movedBy: by });
  tool.jobId = toJobId; // fresh on the receiving job; unconfirmed there until scanned
  await Promise.all([saveTools(tools), saveTransfers(transfers)]);

  return json({
    ok: true,
    closedPeriod: monthLong(period),
    fromJob: findJobById(jobs, fromJobId)?.name || '',
    toJob: toJob.name,
  });
}

async function retireTool(toolId, body) {
  const reason = (body.reason || '').trim();
  if (!reason) return err(400, 'A reason is required');
  const tools = await getTools();
  const tool = findToolById(tools, toolId);
  if (!tool) return err(404, 'Tool not found');
  if (tool.retiredAt) return err(409, 'Tool is already retired');
  tool.retiredAt = new Date().toISOString();
  tool.retiredBy = adminName(body);
  tool.retireReason = reason;
  await saveTools(tools);
  return json({ ok: true, retiredAt: tool.retiredAt });
}

async function auditTool(toolId, body) {
  const note = (body.note || '').trim();
  if (!note) return err(400, 'A note is required'); // handoff: audit note is mandatory
  const [tools] = await Promise.all([getTools()]);
  const tool = findToolById(tools, toolId);
  if (!tool) return err(404, 'Tool not found');
  if (tool.retiredAt) return err(409, 'Tool is retired');
  const period = currentPeriod();
  const { confirmation } = await putConfirmationIfNew({
    id: newId(), toolId: tool.id, jobId: tool.jobId, period,
    confirmedAt: new Date().toISOString(), confirmedBy: adminName(body),
    source: 'audit', note,
  });
  return json({ ok: true, confirmation });
}

/* ── scan handlers (token only) ──────────────────────────────────── */

async function scanState(token) {
  const [jobs, tools] = await Promise.all([getJobs(), getTools()]);
  const tool = findToolByToken(tools, token);
  if (!tool) return err(404, 'Unknown tag');

  if (tool.retiredAt) {
    return json({ state: 'retired', tag: fmtTag(tool.tag), tool: tool.name });
  }

  const job = findJobById(jobs, tool.jobId);
  const period = currentPeriod();
  const conf = await getConfirmation(period, tool.id, tool.jobId);

  return json({
    state: conf ? 'confirmed' : 'open',
    tag: fmtTag(tool.tag),
    tool: tool.name,
    job: job ? { id: job.id, name: job.name } : null,
    period, month: monthLong(period),
    unlocks: firstOfNextMonth(period),
    confirmation: conf
      ? { at: fmtShort(conf.confirmedAt), by: conf.confirmedBy, source: conf.source }
      : null,
  });
}

async function scanConfirm(token) {
  const [jobs, tools] = await Promise.all([getJobs(), getTools()]);
  const tool = findToolByToken(tools, token); // tool comes from the token, never a body
  if (!tool) return err(404, 'Unknown tag');
  if (tool.retiredAt) return err(409, 'Tool is retired');

  const job = findJobById(jobs, tool.jobId);
  const period = currentPeriod();                 // server clock, not the client's
  const by = (job && job.foreman && job.foreman.trim()) || 'Foreman';

  const { confirmation } = await putConfirmationIfNew({
    id: newId(), toolId: tool.id, jobId: tool.jobId, period,
    confirmedAt: new Date().toISOString(), confirmedBy: by, source: 'scan', note: null,
  });

  return json({ ok: true, jobId: tool.jobId, tag: fmtTag(tool.tag), confirmation });
}

/* ── month status list (2b) ──────────────────────────────────────── */

async function monthList(jobId) {
  const [jobs, tools] = await Promise.all([getJobs(), getTools()]);
  const job = findJobById(jobs, jobId);
  if (!job) return err(404, 'Job not found');
  const period = currentPeriod();

  const roster = tools.filter(
    (t) => t.jobId === jobId && !t.retiredAt && countsInPeriod(t, period),
  );

  const rows = await Promise.all(roster.map(async (t) => {
    const confs = await listConfirmationsForTool(t.id);
    const h = toolHistory(t, confs, period);
    const thisConf = confs.find((c) => c.period === period && c.jobId === jobId) || null;
    return {
      id: t.id, tag: fmtTag(t.tag), name: t.name,
      confirmed: h.confirmedThisPeriod,
      missedPrior: h.missedPriorCount,
      lastMarked: h.lastMarked,
      at: thisConf ? fmtShort(thisConf.confirmedAt) : null,
      atRaw: thisConf ? thisConf.confirmedAt : null,
      source: thisConf ? thisConf.source : null,
    };
  }));

  const outstanding = rows
    .filter((r) => !r.confirmed)
    .sort((a, b) => (a.lastMarked || '0').localeCompare(b.lastMarked || '0')); // longest-unseen first
  const present = rows
    .filter((r) => r.confirmed)
    .sort((a, b) => (b.atRaw || '').localeCompare(a.atRaw || '')); // most recent first

  return json({
    job: { id: job.id, name: job.name, foreman: job.foreman || '' },
    period, month: monthLong(period), daysLeft: daysLeftInPeriod(),
    total: roster.length, present: present.length,
    outstanding, presentList: present,
  });
}

/* ── monthly report (2d + 4e) ────────────────────────────────────── */

async function report(monthParam, jobParam) {
  const period = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam : currentPeriod();
  const scopeJob = jobParam && jobParam !== 'all' ? jobParam : null;

  const [jobs, tools, confs] = await Promise.all([
    getJobs(), getTools(), listConfirmationsForPeriod(period),
  ]);
  const jobName = (id) => findJobById(jobs, id)?.name || '';
  const confFor = (toolId, jId) => confs.find((c) => c.toolId === toolId && c.jobId === jId) || null;

  // Per-job summary (roster view): tools currently on the job that count in
  // the period; present = those with a confirmation for (period, tool, job).
  const scopeJobs = jobs.filter((j) => j.active !== false && (!scopeJob || j.id === scopeJob));
  const summary = scopeJobs.map((j) => {
    const roster = tools.filter((t) => t.jobId === j.id && countsInPeriod(t, period));
    const present = roster.filter((t) => confFor(t.id, j.id)).length;
    const total = roster.length;
    return {
      id: j.id, name: j.name, foreman: j.foreman || '',
      tools: total, present, outstanding: total - present,
      pct: total ? Math.round((present / total) * 100) : 0,
    };
  });

  // Outstanding across scope.
  const outstanding = [];
  for (const t of tools) {
    if (scopeJob && t.jobId !== scopeJob) continue;
    if (!countsInPeriod(t, period)) continue;
    if (t.retiredAt) continue;
    if (confFor(t.id, t.jobId)) continue;
    const all = await listConfirmationsForTool(t.id);
    const h = toolHistory(t, all, period);
    outstanding.push({
      tag: fmtTag(t.tag), name: t.name, jobName: jobName(t.jobId),
      lastMarked: h.lastMarked ? monthLong(h.lastMarked) : '—',
      stale: !!h.lastMarked && h.lastMarked < addMonths(period, -1),
    });
  }

  // Provenance rows (4e): confirmations in the period (carry the job they
  // were closed on, even if the tool has since moved), plus current-roster
  // "Open" rows, plus tools retired in this period (shown once).
  const seen = new Set();
  const prov = [];
  for (const c of confs) {
    if (scopeJob && c.jobId !== scopeJob) continue;
    const t = findToolById(tools, c.toolId);
    if (!t) continue;
    seen.add(`${c.toolId}:${c.jobId}`);
    prov.push({
      tag: fmtTag(t.tag), name: t.name, jobName: jobName(c.jobId),
      closed: fmtShort(c.confirmedAt), how: c.source, note: c.note || '',
      open: false, retired: false,
    });
  }
  for (const t of tools) {
    if (scopeJob && t.jobId !== scopeJob) continue;
    const key = `${t.id}:${t.jobId}`;
    if (retiredInPeriod(t, period)) {
      if (seen.has(key)) continue;
      prov.push({
        tag: fmtTag(t.tag), name: t.name, jobName: jobName(t.jobId),
        closed: '—', how: 'retired', note: t.retireReason || '', open: false, retired: true,
      });
      seen.add(key);
      continue;
    }
    if (!countsInPeriod(t, period)) continue;
    if (seen.has(key)) continue;
    prov.push({
      tag: fmtTag(t.tag), name: t.name, jobName: jobName(t.jobId),
      closed: 'Open', how: null, note: '', open: true, retired: false,
    });
    seen.add(key);
  }
  prov.sort((a, b) => a.tag.localeCompare(b.tag));

  const totalTools = summary.reduce((n, s) => n + s.tools, 0);
  const totalPresent = summary.reduce((n, s) => n + s.present, 0);

  return json({
    period, monthLabel: monthLongYear(period), daysLeft: daysLeftInPeriod(),
    scope: scopeJob ? jobName(scopeJob) : 'All jobs',
    jobs: jobs.filter((j) => j.active !== false).map((j) => ({ id: j.id, name: j.name })),
    totals: { tools: totalTools, present: totalPresent },
    summary, outstanding, provenance: prov,
  });
}
