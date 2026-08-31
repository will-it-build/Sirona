# Sirona — Training Log (Will It Build 002)

Named for Sirona, Celtic goddess of healing and renewal.

Digital PPL training log. Auto-dated sessions, day-filtered exercise
dropdowns (from the paper log's menus + custom), kg × reps × optional RPE,
per-exercise notes, session info, last-session markers, live "beat" flags,
Progress tab (best set, estimated 1RM, trend chart, PR flags, per-session
deltas), plate calculator, ledger, JSON export/import, in-session rest timer.

## Architecture
- public/index.html — the whole app. localStorage = offline cache only.
- worker.js — serves the app + auth + /api/sessions sync API.
- Cloudflare D1 (sirona-db) = source of truth. Phone storage can be
  wiped by Safari; the database can't.

Offline-first: no signal in the gym is fine. Syncs on load and after
every change. Header dot: green = synced, grey = local-only, red = error.

## Login
Username + password, hashed in D1 (PBKDF2-SHA-256). The Worker sets an
HttpOnly `sirona` session cookie. The app never stores a passphrase or
`sirona-key` in localStorage.

First visit (no users yet): create-account form (username, email,
password). One user is enough.

Forgot password: request a reset (username or email) → Worker stores a
one-hour token → `/?reset=<token>` sets a new password. Sending the
mail needs a provider the Worker does not ship: set Wrangler secrets
`RESEND_API_KEY` and `MAIL_FROM` (Resend). Until those exist, login
and persist still work; the reset token is stored and the reset page
works if you have the link.

## Sync
GET `/api/sessions`, merge with **completed-on-server winning over
empty or planned local**, PUT **upserts only**. The browser never
sends `full: true`. The Worker ignores that flag for deletions — a
stale or empty cache cannot wipe completed history. Deletes go through
`DELETE /api/sessions/:id`.

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

## Rest timer
Visible on Today as soon as the session logger is open — before any set
is logged. Idle default: 60s between sets. Logging a set starts the
countdown (60s same exercise, 90s when that exercise’s last-session set
count is done and another move is next). Tap the kind label to switch
60/90 presets. Slider sets 30–120 seconds for the current kind. Hidden
on Week, Ledger, and Progress.

## Deploy
    npx wrangler deploy
D1 database + sessions table must exist (see wrangler.jsonc binding).
Auth tables are created on first API request (see schema.sql).

Optional (password-reset mail):

    npx wrangler secret put RESEND_API_KEY
    npx wrangler secret put MAIL_FROM

`SIRONA_KEY` is no longer used by the app. A Bearer token of that
secret still works for ops if the secret is set.

Custom domain: dashboard → Workers → sirona → Settings → Domains & Routes
→ Add → sirona.will-it-build.com.

## Fork it
All Will It Build code is open source. To run your own: create a D1
database, put its id in wrangler.jsonc, deploy, create the first account
in the app.
