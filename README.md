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

## Week planning
Week tab: coming seven days. Plan a session (Push/Pull/Legs, ordered
exercises from the menus, optional notes). Sets stay empty until you
train. On the day, Today loads that list into the logger automatically —
names only, expand an exercise to log sets. Session info stays collapsed
until you open it. Finish marks that session `done`; it then behaves like
any other log (ledger, last-session markers, PRs). Progress / 1RM /
trends ignore `status: "planned"` so empty plans never pollute numbers.

Sessions are one object either way:

    { id, date, day, status: "planned"|"done", notes?, meta?, entries }

Missing `status` is treated as done (older logs). `date` is ISO; plans
use local noon on that calendar day.

GET `/api/sessions` returns planned and done. PUT upserts by `id`. Do
**not** send `full: true` from an external client unless the payload is
the complete history — that flag deletes anything missing from the list.
The in-app sync still uses `full: true` because it has the merged set.

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
