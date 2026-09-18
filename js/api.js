// js/api.js
// Fetch client for the Tool Register API. Every screen goes through here.
// Methods mirror the endpoints in netlify/functions/api.mjs.

import { CONFIG } from './config.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network failure (offline at the truck, DNS, etc.)
    throw new ApiError('Network error — check the connection and try again.', 0);
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty / non-JSON body */ }

  if (!res.ok) {
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status);
  }
  return data;
}

// Attach the admin display name for attribution on office actions.
const withAdmin = (body = {}) => ({ ...body, by: CONFIG.ADMIN_NAME });

export const api = {
  // ── jobs ──
  listJobs:  ()               => request('/jobs'),
  getJob:    (jobId)          => request(`/jobs/${jobId}`),
  createJob: (name, foreman)  => request('/jobs', { method: 'POST', body: { name, foreman } }),
  monthList: (jobId)          => request(`/jobs/${jobId}/month`),

  // ── tools ──
  addTools:  (jobId, name, quantity) =>
    request('/tools', { method: 'POST', body: { jobId, name, quantity } }),
  transfer:  (toolId, toJobId, movedAt) =>
    request(`/tools/${toolId}/transfer`, { method: 'POST', body: withAdmin({ toJobId, movedAt }) }),
  retire:    (toolId, reason) =>
    request(`/tools/${toolId}/retire`, { method: 'POST', body: withAdmin({ reason }) }),
  audit:     (toolId, note) =>
    request(`/tools/${toolId}/audit`, { method: 'POST', body: withAdmin({ note }) }),

  // ── labels ──
  markLabelsPrinted: (toolIds) =>
    request('/labels/mark-printed', { method: 'POST', body: { toolIds } }),

  // ── scan (token-scoped, public) ──
  scanState:   (token) => request(`/scan/${token}`),
  confirmScan: (token) => request(`/scan/${token}/confirm`, { method: 'POST' }),

  // ── misc ──
  nextTag: ()             => request('/next-tag'),
  report:  (month, job)   => {
    const q = new URLSearchParams();
    if (month) q.set('month', month);
    if (job)   q.set('job', job);
    const qs = q.toString();
    return request(`/report${qs ? `?${qs}` : ''}`);
  },
};
