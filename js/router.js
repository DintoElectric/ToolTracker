// js/router.js
// Entry module (loaded by index.html). Path-based routing over the SPA
// shell: match pathname → screen, set the surface, hand the screen a
// context with params/query and a navigate() for client-side links.

import { closeAnyMenu, centerNote, mount } from './ui.js';

import { screenScan }   from './screens/scan.js';    // /t/:token           (2a / 2c)
import { screenMonth }  from './screens/month.js';   // /jobs/:jobId/month  (2b)
import { screenJobs }   from './screens/jobs.js';    // /admin/jobs         (3a)
import { screenTools }  from './screens/tools.js';   // /admin/jobs/:jobId  (3b, 4a–4d)
import { screenLabels } from './screens/labels.js';  // /admin/jobs/:jobId/labels (3c)
import { screenReport } from './screens/report.js';  // /admin/reports      (2d / 4e)

// route table: [regex, paramNames, screen, surface]
const ROUTES = [
  [/^\/t\/([^/]+)\/?$/,                        ['token'],  screenScan,   'mobile'],
  [/^\/jobs\/([^/]+)\/month\/?$/,              ['jobId'],  screenMonth,  'mobile'],
  [/^\/admin\/jobs\/?$/,                       [],         screenJobs,   'admin'],
  [/^\/admin\/jobs\/([^/]+)\/labels\/?$/,      ['jobId'],  screenLabels, 'admin'],
  [/^\/admin\/jobs\/([^/]+)\/?$/,              ['jobId'],  screenTools,  'admin'],
  [/^\/admin\/reports\/?$/,                    [],         screenReport, 'admin'],
];

function match(pathname) {
  for (const [re, names, screen, surface] of ROUTES) {
    const m = re.exec(pathname);
    if (!m) continue;
    const params = {};
    names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
    return { screen, params, surface };
  }
  return null;
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render();
}

function render() {
  closeAnyMenu();

  const { pathname, searchParams } = new URL(window.location.href);

  // Default landing → admin jobs.
  if (pathname === '/' || pathname === '') {
    navigate('/admin/jobs', { replace: true });
    return;
  }

  const hit = match(pathname);
  if (!hit) {
    document.body.dataset.surface = 'admin';
    mount(centerNote('Page not found', 'That link doesn’t match anything here.'));
    return;
  }

  document.body.dataset.surface = hit.surface;

  const ctx = {
    params: hit.params,
    query: Object.fromEntries(searchParams.entries()),
    navigate,
  };

  try {
    hit.screen(ctx);
  } catch (e) {
    mount(centerNote('Something went wrong', e?.message || String(e)));
  }
}

// Client-side links: any <a data-link href="/…"> navigates without reload.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-link]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('http') || a.target === '_blank') return;
  e.preventDefault();
  navigate(href);
});

window.addEventListener('popstate', render);
render(); // first paint
