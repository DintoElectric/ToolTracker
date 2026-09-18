// netlify/functions/store.mjs
// Data layer for the Dinto Tool Register.
// - Owns the Netlify Blobs store and every read/write.
// - Owns the clock: periods (YYYY-MM) are always derived here from the
//   server's time in the company timezone, never from the client.
// - Provides idempotent confirmation writes and the derived helpers
//   (retirement windows, missed-month counting) used by the report.

import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

// Company timezone. Confirmations, "days left" and the current month are
// all computed against this, so a phone in another timezone can't shift
// which month a scan lands in.
export const TZ = 'America/New_York';

// The single store. getStore() must be called inside a request (Netlify
// injects the credentials per-invocation), so this is a function, not a
// module-level constant. Strong consistency gives us read-after-write,
// which the idempotent-confirm and immediate-report paths rely on.
export function store() {
  return getStore({ name: 'tool-register', consistency: 'strong' });
}

/* ── clock & periods ─────────────────────────────────────────────── */

// "YYYY-MM-DD" for a date in the company timezone. en-CA formats this way.
export function ymdInTZ(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

// Current period, e.g. "2026-09".
export function currentPeriod() {
  return ymdInTZ().slice(0, 7);
}

// The period a given date falls in.
export function periodOf(dateOrISO) {
  return ymdInTZ(new Date(dateOrISO)).slice(0, 7);
}

// Whole days remaining in the current month (Sep 18 in a 30-day month → 12).
export function daysLeftInPeriod() {
  const [y, m, d] = ymdInTZ().split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  return lastDay - d;
}

// Period arithmetic. addMonths("2026-01", -1) → "2025-12".
export function addMonths(period, delta) {
  const [y, m] = period.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
export function prevPeriod(period) {
  return addMonths(period, -1);
}

/* ── ids & formatting ────────────────────────────────────────────── */

export function newId() {
  return randomUUID();
}

// Unguessable per-tool scan token. The QR encodes /t/<token>; the token is
// what makes the confirm page work with no login. 32 hex chars.
export function newToken() {
  return randomUUID().replace(/-/g, '');
}

// Tag display form: 14 → "014". Grows past 999 without breaking (→ "1000").
export function fmtTag(n) {
  return String(n).padStart(3, '0');
}

/* ── aggregate documents (admin-written, single-writer) ──────────── */

async function readArray(key) {
  const val = await store().get(key, { type: 'json' });
  return Array.isArray(val) ? val : [];
}

export const getJobs      = () => readArray('jobs');
export const getTools     = () => readArray('tools');
export const getTransfers = () => readArray('transfers');

export const saveJobs      = (jobs)      => store().setJSON('jobs', jobs);
export const saveTools     = (tools)     => store().setJSON('tools', tools);
export const saveTransfers = (transfers) => store().setJSON('transfers', transfers);

/* ── tag counter ─────────────────────────────────────────────────── */

async function getMeta() {
  const meta = await store().get('meta', { type: 'json' });
  return meta && typeof meta.nextTag === 'number' ? meta : { nextTag: 1 };
}

// The tag the NEXT added tool will get, for the "Next tag 052" preview.
export async function peekNextTag() {
  return (await getMeta()).nextTag;
}

// Reserve `count` sequential tags and advance the counter. Returns the ints.
// Numbers are global across jobs and never reused, even after retirement.
export async function mintTags(count) {
  const meta = await getMeta();
  const start = meta.nextTag;
  const nums = Array.from({ length: count }, (_, i) => start + i);
  await store().setJSON('meta', { nextTag: start + count });
  return nums;
}

/* ── confirmations (one blob per (period, tool, job)) ────────────── */

export function confKey(period, toolId, jobId) {
  return `conf:${period}:${toolId}:${jobId}`;
}

export async function getConfirmation(period, toolId, jobId) {
  return store().get(confKey(period, toolId, jobId), { type: 'json' });
}

// Idempotent write. If a confirmation already exists for this
// (period, tool, job) it is returned unchanged and nothing is created —
// so a double-tap, or a transfer that races a scan, never doubles up.
export async function putConfirmationIfNew(conf) {
  const s = store();
  const key = confKey(conf.period, conf.toolId, conf.jobId);

  const existing = await s.get(key, { type: 'json' });
  if (existing) return { created: false, confirmation: existing };

  try {
    await s.setJSON(key, conf, { onlyIfNew: true }); // atomic create-if-absent
  } catch {
    // A simultaneous writer won the race; fall through and read theirs.
  }
  const saved = await s.get(key, { type: 'json' });
  return { created: !!saved && saved.id === conf.id, confirmation: saved || conf };
}

// All confirmations in a month, across every job/tool. Used by the report.
export async function listConfirmationsForPeriod(period) {
  const s = store();
  const { blobs } = await s.list({ prefix: `conf:${period}:` });
  const items = await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' })));
  return items.filter(Boolean);
}

// Every confirmation for one tool, across all months/jobs. Used for the
// month status list (missed-month flags) and a tool's history.
export async function listConfirmationsForTool(toolId) {
  const s = store();
  const { blobs } = await s.list({ prefix: 'conf:' });
  const mine = blobs.filter((b) => b.key.split(':')[2] === toolId);
  const items = await Promise.all(mine.map((b) => s.get(b.key, { type: 'json' })));
  return items.filter(Boolean);
}

/* ── lookups ─────────────────────────────────────────────────────── */

export function findToolByToken(tools, token) {
  return tools.find((t) => t.scanToken === token) || null;
}
export function findToolById(tools, id) {
  return tools.find((t) => t.id === id) || null;
}
export function findJobById(jobs, id) {
  return jobs.find((j) => j.id === id) || null;
}

/* ── derived rules for a period ──────────────────────────────────── */
// A tool "counts" in a month unless it was retired in that month or earlier.
// (Retired tools drop out of counts, outstanding lists and reports from the
//  retirement date forward — handoff rule 2.)
export function countsInPeriod(tool, period) {
  return !tool.retiredAt || periodOf(tool.retiredAt) > period;
}

// The report lists a retired tool once — in the exact month it was retired —
// then never again.
export function retiredInPeriod(tool, period) {
  return !!tool.retiredAt && periodOf(tool.retiredAt) === period;
}

export function existedInPeriod(tool, period) {
  return periodOf(tool.createdAt) <= period;
}

// From a tool's confirmations, summarise its history relative to `period`:
//   confirmedThisPeriod — marked present this month, on its CURRENT job
//   lastMarked          — most recent PRIOR period with any confirmation, or null
//   missedPriorCount    — consecutive prior months the tool existed, wasn't
//                         retired, and was never marked (drives "Missed August too")
export function toolHistory(tool, confs, period) {
  const marked = new Set(confs.map((c) => c.period));

  const confirmedThisPeriod = confs.some(
    (c) => c.period === period && c.jobId === tool.jobId,
  );

  let lastMarked = null;
  for (const p of marked) {
    if (p < period && (lastMarked === null || p > lastMarked)) lastMarked = p;
  }

  let missedPriorCount = 0;
  let p = prevPeriod(period);
  while (existedInPeriod(tool, p) && countsInPeriod(tool, p)) {
    if (marked.has(p)) break;
    missedPriorCount += 1;
    p = prevPeriod(p);
    if (missedPriorCount > 240) break; // hard stop; 20 years
  }

  return { confirmedThisPeriod, lastMarked, missedPriorCount };
}
