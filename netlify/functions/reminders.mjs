// netlify/functions/reminders.mjs
// Scheduled reminders: twice a week, each foreman with outstanding tools this
// month gets a nudge — count outstanding, job name, days left, deep link to
// that job's month list (2b). Foremen at zero are skipped entirely.
//
// Schedule is UTC (Netlify cron has no timezone). 12:00 UTC ≈ 7am EST / 8am
// EDT — a reasonable "morning" in America/New_York year-round. Adjust the
// hour if you want it earlier/later. Tue = 2, Fri = 5.
//
// Scheduled functions only fire on PUBLISHED deploys (not previews). To test
// on demand, use "Run now" in Netlify → Functions, or trigger via the CLI.

import {
  getJobs, getTools, store,
  currentPeriod, daysLeftInPeriod, countsInPeriod,
  listConfirmationsForPeriod,
} from './store.mjs';
import { deliver, anyChannelConfigured } from './notify.mjs';

export const config = { schedule: '0 12 * * 2,5' };

// Site origin for deep links. Netlify sets URL to the site's main address.
const siteOrigin = () =>
  (process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/+$/, '');

/* ── contact resolution ──────────────────────────────────────────── */
// A foreman's contact comes from the job first (foremanEmail / foremanPhone),
// then a `contacts` blob: { "D. Ruiz": { email, phone }, ... }. Populate
// either one and reminders start flowing; until then it's log-only.
async function loadContacts() {
  try {
    const c = await store().get('contacts', { type: 'json' });
    return c && typeof c === 'object' ? c : {};
  } catch {
    return {};
  }
}

function contactFor(job, contacts) {
  const byName = (job.foreman && contacts[job.foreman]) || {};
  return {
    name: job.foreman || 'Foreman',
    email: (job.foremanEmail || byName.email || '').trim() || null,
    phone: (job.foremanPhone || byName.phone || '').trim() || null,
  };
}

/* ── message ─────────────────────────────────────────────────────── */
function buildMessage({ jobName, count, daysLeft, link }) {
  const tools = `${count} ${count === 1 ? 'tool' : 'tools'}`;
  const days = `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;

  const subject = `${count} ${count === 1 ? 'tool' : 'tools'} still outstanding — ${jobName}`;
  const text =
    `${jobName}: ${tools} still need a scan this month. ${days}.` +
    (link ? `\nMark them: ${link}` : '');
  const html =
    `<p style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif">` +
    `<strong>${escapeHtml(jobName)}</strong>: ${tools} still need a scan this month. ${days}.` +
    (link ? `<br><a href="${link}">Open the month's list</a></p>` : '</p>');

  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

/* ── outstanding-per-job for the current month ───────────────────── */
async function outstandingByJob() {
  const period = currentPeriod();
  const [jobs, tools, confs] = await Promise.all([
    getJobs(), getTools(), listConfirmationsForPeriod(period),
  ]);

  // Set of (tool,job) pairs confirmed this period.
  const confirmed = new Set(confs.map((c) => `${c.toolId}:${c.jobId}`));

  const rows = [];
  for (const job of jobs) {
    if (job.active === false) continue;
    const roster = tools.filter(
      (t) => t.jobId === job.id && !t.retiredAt && countsInPeriod(t, period),
    );
    const outstanding = roster.filter((t) => !confirmed.has(`${t.id}:${job.id}`)).length;
    if (outstanding > 0) rows.push({ job, outstanding });
  }
  return { rows, daysLeft: daysLeftInPeriod() };
}

/* ── handler ─────────────────────────────────────────────────────── */
export default async function handler() {
  const started = new Date().toISOString();
  try {
    const [{ rows, daysLeft }, contacts] = await Promise.all([
      outstandingByJob(), loadContacts(),
    ]);
    const origin = siteOrigin();
    const wiring = anyChannelConfigured();

    if (!rows.length) {
      console.log('[reminders] nothing outstanding — no reminders sent.', { started });
      return new Response('ok: nothing outstanding', { status: 200 });
    }

    const results = [];
    for (const { job, outstanding } of rows) {
      const recipient = contactFor(job, contacts);
      const link = origin ? `${origin}/jobs/${job.id}/month` : '';
      const message = buildMessage({ jobName: job.name, count: outstanding, daysLeft, link });
      try {
        const sent = await deliver(recipient, message);
        results.push({ job: job.name, outstanding, ...sent, ok: true });
      } catch (e) {
        // One bad contact must not stop the others.
        results.push({ job: job.name, outstanding, ok: false, error: e.message });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    console.log('[reminders] run complete', {
      started, jobsNotified: rows.length, sent,
      channels: wiring, results,
    });
    return new Response(`ok: ${sent}/${rows.length} sent`, { status: 200 });
  } catch (e) {
    console.error('[reminders] run failed', e?.message || e);
    return new Response('error', { status: 500 });
  }
}
