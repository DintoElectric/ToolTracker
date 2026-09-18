// js/ui.js
// Shared DOM helpers and the dialog / menu primitives. No framework —
// a tiny el() builder plus a few utilities the screens compose.

/* ── el(): terse element builder ─────────────────────────────────────
   el('div', { class:'card', onClick:fn, data:{label:'Tag'} }, child, 'text')
   - class / className → className
   - text            → textContent
   - html            → innerHTML (only used with strings WE control, e.g. icons)
   - style           → Object.assign(el.style, …)
   - data            → data-* attributes
   - onXxx           → addEventListener('xxx', fn)
   - anything else   → setAttribute
   children: nodes are appended; strings become text nodes; null/false skipped */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k === 'data') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else if (/^on[A-Z]/.test(k)) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const frag = (...nodes) => {
  const f = document.createDocumentFragment();
  for (const n of nodes.flat()) if (n != null && n !== false)
    f.appendChild(n instanceof Node ? n : document.createTextNode(String(n)));
  return f;
};

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

// Render a screen into #app and reset scroll.
export function mount(node) {
  const app = document.getElementById('app');
  clear(app);
  app.appendChild(node);
  window.scrollTo(0, 0);
}

/* ── icons (Phosphor, regular weight, inlined) ───────────────────── */
const ICON_PATHS = {
  check:
    'M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z',
  search:
    'M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z',
};
export function icon(name, cls = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATHS[name] || '');
  svg.appendChild(path);
  return svg;
}

/* ── button busy state (scan confirm, dialog submits) ────────────── */
export function busy(btn, isBusy, busyLabel) {
  if (isBusy) {
    btn.dataset.label = btn.dataset.label ?? btn.textContent;
    if (busyLabel) btn.textContent = busyLabel;
    btn.classList.add('is-pending');
    btn.disabled = true;
  } else {
    if (btn.dataset.label != null) btn.textContent = btn.dataset.label;
    btn.classList.remove('is-pending');
    btn.disabled = false;
  }
}

/* ── formatters (client-side; server sends most display strings) ─── */
export const fmtLongDate = (d) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(d instanceof Date ? d : new Date(d));

// yyyy-mm-dd for a <input type="date"> default (local).
export const todayInputValue = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ── dialog ──────────────────────────────────────────────────────────
   openDialog(buildBody) mounts a backdrop + .dialog, calls buildBody(close)
   to fill it, and wires Esc + backdrop-click to close. Returns close().  */
export function openDialog(buildBody) {
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' });
  const backdrop = el('div', { class: 'dialog-backdrop' }, dialog);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);

  buildBody(dialog, close);
  document.body.appendChild(backdrop);

  // Focus the first field / actionable control.
  const first = dialog.querySelector('input, textarea, select, button');
  if (first) first.focus();

  return close;
}

/* ── row menu (4a popover) ───────────────────────────────────────────
   openMenu(anchorEl, items) — items: { label, onClick, destructive, sepBefore }.
   Anchors inside the given positioned container; closes on outside click/Esc. */
export function openMenu(anchorEl, items) {
  closeAnyMenu();
  const menu = el('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it.sepBefore) menu.appendChild(el('div', { class: 'menu-sep' }));
    menu.appendChild(
      el('button', {
        class: `menu-item${it.destructive ? ' destructive' : ''}`,
        role: 'menuitem', type: 'button',
        onClick: () => { closeAnyMenu(); it.onClick(); },
      }, it.label),
    );
  }
  anchorEl.appendChild(menu);

  const onDown = (e) => { if (!menu.contains(e.target) && !anchorEl.contains(e.target)) closeAnyMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') closeAnyMenu(); };
  // Defer so the click that opened the menu doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
  }, 0);

  closeAnyMenu._active = () => {
    document.removeEventListener('mousedown', onDown);
    document.removeEventListener('keydown', onKey);
    menu.remove();
  };
  menu.querySelector('.menu-item')?.focus();
}
export function closeAnyMenu() {
  if (typeof closeAnyMenu._active === 'function') {
    const fn = closeAnyMenu._active; closeAnyMenu._active = null; fn();
  }
}

/* ── generic full-screen state (loading / error) ─────────────────── */
export function centerNote(text, sub) {
  return el('div', { style: { maxWidth: '460px', margin: '0 auto', padding: '80px 22px' } },
    el('div', { style: { fontSize: '18px', fontWeight: '500' }, text }),
    sub ? el('div', { style: { color: 'var(--color-neutral-500)', marginTop: '10px', fontSize: '13.5px' }, text: sub }) : null,
  );
}
