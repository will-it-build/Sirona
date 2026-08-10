# Sirona — Training Log (Will It Build 002)

Named for Sirona, Celtic goddess of healing and renewal.

Digital PPL training log. Auto-dated sessions, day-filtered exercise
dropdowns (from the paper log's menus + custom), kg × reps × optional RPE,
per-exercise notes, session info, last-session markers, live "beat" flags,
Progress tab (best set, estimated 1RM, trend chart, PR flags, per-session
deltas), plate calculator, ledger, JSON export/import.

## Architecture
- public/index.html — the whole app. localStorage = offline cache.
- worker.js — serves the app + /api/sessions sync API.
- Cloudflare D1 (sirona-db) = source of truth. Phone storage can be
  wiped by Safari; the database can't.

Offline-first: no signal in the gym is fine. Syncs on load and after
every change. Header dot: green = synced, grey = local-only, red = error.

## Deploy
    npx wrangler secret put SIRONA_KEY     # pick a passphrase
    npx wrangler deploy
App asks for the passphrase once per browser, then remembers it.
D1 database + schema must exist (see wrangler.jsonc binding).

Custom domain: dashboard → Workers → sirona → Settings → Domains & Routes
→ Add → sirona.will-it-build.com.

## Fork it
All Will It Build code is open source. To run your own: create a D1
database, put its id in wrangler.jsonc, set your own SIRONA_KEY, deploy.
