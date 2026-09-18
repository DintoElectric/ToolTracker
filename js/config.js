// js/config.js
// App-wide constants. Everything you'd tweak per-deploy lives here.

export const CONFIG = {
  // Shown in the admin nav ("M. Dinto · Admin") and attributed to
  // audit / transfer / retire actions until real auth is added.
  ADMIN_NAME: 'M. Dinto',
  ADMIN_ROLE: 'Admin',

  // Brand text in the admin nav bar.
  BRAND: 'Dinto Tool Register',

  // API root. The function serves everything under /api (see api.mjs).
  API_BASE: '/api',

  // Base for the QR payload on printed labels. Empty string = use the
  // current site origin at print time (correct for a normal deploy). Set an
  // explicit "https://tools.dintoelectric.com" only if labels must encode a
  // custom domain that differs from where the admin prints them.
  SCAN_ORIGIN: '',
};

// The full scan URL a QR encodes for a given tool token: e.g.
// https://<site>/t/ab12cd… — this is what the phone camera opens.
export function scanUrl(token) {
  const origin = CONFIG.SCAN_ORIGIN || window.location.origin;
  return `${origin}/t/${token}`;
}
