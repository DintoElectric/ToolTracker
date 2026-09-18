
---

## Deploy (GitHub → Netlify)

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Build settings — Netlify reads `netlify.toml`, so leave the defaults:
   - Build command: `echo 'No build step — static front-end.'`
   - Publish directory: `.`
   - Functions directory: `netlify/functions`
4. Deploy. Netlify installs `@netlify/blobs` (for the function), publishes the
   static files, and wires the `/api/*` function automatically.

There is nothing to configure for storage — Blobs works on the first deploy.

### Custom domain (optional)

Point a domain (e.g. `tools.dintoelectric.com`) at the site in Netlify's
**Domain management**. The QR labels encode whatever origin they're printed
from, so once the domain is live, reprint any labels made before it was set —
or set `SCAN_ORIGIN` in `js/config.js` to pin the origin regardless of where
you print.

---

## Configuration (`js/config.js`)

- **`ADMIN_NAME` / `ADMIN_ROLE`** — shown in the admin nav and attributed to
  audit, transfer and retire actions. Change this to the office user's name.
- **`BRAND`** — the nav bar title.
- **`SCAN_ORIGIN`** — leave empty to use the current site origin (correct for a
  normal deploy). Set it only if labels must encode a domain different from
  where they're printed.

---

## Access / auth

- **The scan flow is intentionally open.** A phone camera opens `/t/<token>`
  in a plain browser with no app and no login — a field crew at a truck with no
  signal must be able to press the button. The token in the URL is the tool's
  unguessable key; it maps to exactly one tool.
- **The admin area has no login in this version.** For an internal tool on an
  obscure URL that's often acceptable, but to lock it down, enable Netlify's
  site protection:
  - **Site-wide password** — Netlify → Site configuration → Access & security →
    Visitor access → Password protection. (Note this also gates the scan pages,
    so use it only if foremen can be given the password.)
  - **Per-path / role-based access** or **Netlify Identity** if you need the
    `/admin/*` pages protected while `/t/*` stays open. The functions are
    written so real per-user attribution can replace `ADMIN_NAME` later.

---

## How the settled rules are implemented

- **Transfer restarts the clock.** Moving a tool writes a `transfer`
  confirmation for the *departing* job's current month (the move stands in for
  that scan) and moves the tool to the new job, where it's outstanding until
  scanned there. Because a tool can therefore be confirmed for two jobs in one
  month, confirmations are keyed by **(month + tool + job)**, not (month + tool)
  — a deliberate deviation from the handoff's stated unique index, needed for
  the transfer rule to be consistent.
- **Retire.** Sets `retiredAt`; the tool drops out of every count, outstanding
  list and report from that month forward, stops accruing missed months, keeps
  its history, and its tag is never reused. Scanning a retired tool shows a
  terminal "retired" screen, not an error.
- **Audit.** The one path that bypasses a scan. Admin-only, always attributed,
  and requires a written note. Audit closes read distinctly everywhere a
  confirmation appears (2b, the tables, and the report's **How** column) and in
  the CSV export.

The server owns the clock: the current month is always computed from the
server's time in `America/New_York` (`TZ` in `store.mjs`), never trusted from a
client. Confirmations are idempotent — a double-tap, or a transfer racing a
scan, never creates a second record.

---

## Known gaps (deliberate, flagged during the build)

- **"Download PDF"** on the label sheet uses the browser's Print → Save as PDF
  rather than generating a file directly. A one-click PDF can be added later
  with a PDF library.
- **Reminders** (the twice-weekly foreman notifications described in the
  design) are not built — no scheduler or messaging is wired up.
- **Icons** — the two Phosphor icons (check, magnifier) are inlined as SVG
  rather than pulled from the package, since there's no build step.

---

## Local development

```bash
npm install
npm install -g netlify-cli   # first time only
netlify dev
```

`netlify dev` serves the static files, runs the function, and gives you a local
Blobs store, so the whole app works end to end at `http://localhost:8888`.
Create a job, add a tool, open its label sheet, and scan the QR with a phone on
the same network (or open the `/t/<token>` URL directly) to exercise the
confirm flow.
