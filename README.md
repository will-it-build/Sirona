# Sirona — training log

A responsive workout logger with private accounts, weekly planning, exercise
history and progress charts. Sirona remains the working name and current domain.

This branch prepares the public-account release. Public signup is disabled in
production configuration until recovery email and the migration are verified.
See [RELEASE.md](RELEASE.md) before deploying an existing database.

## Run locally

Requires Node.js 22.13 or newer (the backend tests use `node:sqlite`).

```sh
npm ci
npm run db:local
npx wrangler dev --local --var PUBLIC_SIGNUP:true
```

Local D1 storage is separate from production. Create a test account through the
signup form. For local recovery-email development, use an ignored `.dev.vars`
file for `RESEND_API_KEY` and `MAIL_FROM`; do not use real recipient addresses in
automated tests. Automated email tests mock the provider and send no messages.

```sh
npm test
npm run check
npm run test:browser
npm run deploy:check
```

Browser checks use installed Chrome locally, port 8788 and a fresh isolated D1
store for each run. In CI, install Playwright Chromium with
`npx playwright install --with-deps chromium`. Deployment checks build the bundle
without publishing it. Browser artifacts and local databases are gitignored.

## Architecture and accounts

- `public/index.html` and `public/app.js`: existing training UI, authentication,
  draft autosave and recovery controls.
- `public/sync.js`: account-scoped offline queue with acknowledged revisions.
- `public/validation.js`: workout validation shared by browser imports and API.
- `worker.js` and `auth.js`: same-origin JSON API, password hashing, session cookies,
  throttling and Resend password-recovery delivery.
- Cloudflare D1: persistent accounts and private records. Schema changes live in
  `migrations/`; the Worker does not create tables during requests.

Signup requires a username, email and password of at least 12 characters. Login
accepts username or email. Session cookies are HttpOnly, SameSite=Strict and Secure
on HTTPS. Tokens are stored as hashes; passwords retain the existing PBKDF2 format
so current accounts can still log in. Public signup is controlled by
`PUBLIC_SIGNUP`. `MAINTENANCE_MODE` blocks API requests before database access.

Password reset links expire after one hour, can be used only once and revoke
existing sessions. Configure Resend using secrets `RESEND_API_KEY` and `MAIL_FROM`
and a verified sending domain. Provider failures are logged without recipient,
password or reset-token data. Successful automated tests do not prove real inbox
delivery; that is a separate release gate.

## Saving and recovery

Workouts and the active draft are private to their authenticated owner. The
browser caches data under that account's ID and sends an account ID guard with
record requests to prevent an old queue saving under a different login.

Each save carries the last acknowledged revision and a unique mutation ID. A
retry after a lost response is idempotent. Competing edits are retained for the
user to resolve. Deleted sessions leave tombstones so stale devices cannot bring
them back; explicit restoration creates a new session instead.

The status banner distinguishes pending local edits, saving, errors and conflicts.
Offline drafts survive reload on a device previously signed in. Reconnecting
retries the queue. One editing tab is allowed per browser where Web Locks is
supported. Logging out revokes the server session; it requires a connection.
Cached records remain on the device for the next login, so use a trusted browser.

Device storage is not a backup: clearing browser data can lose unsynced changes.
Use Ledger → Export JSON before clearing storage, changing domains or resolving
uncertain edits. Imports create new session identities and can duplicate sessions
if the same file is imported repeatedly. Export includes the draft and pending
queue for recovery; the ordinary import control imports only sessions.

The previous unscoped `sirona-v1` cache is preserved but never automatically
assigned to a public account. Export it from the old app before rollout and review
any unsynced sessions against the migrated ledger before importing missing ones.

The retired shared `/api/sessions` API rejects requests with an update-required
response. There is no shared bearer-token backdoor for records.

## Phone use

The web manifest and service worker support home-screen installation. Android
browsers may offer Install; on iPhone use Safari's Add to Home Screen. The service
worker caches the app shell, never API responses or password-reset URLs. Offline
access requires a previous successful sign-in and shell download. This is a web
app, not an App Store release. Real-device installation remains a manual check.

## Product scope

Workouts, plans, set notes, rest timer, plate calculator, ledger, JSON export and
exercise progress remain available. Bodyweight can be noted with a workout.
Independent morning/evening weigh-ins, meals/protein and authorised ChatGPT access
are later work, not implemented features. ChatGPT access must be scoped and
revocable; it must not reuse a shared admin secret. Exercise animations are deferred.

## New installations

Create a separate D1 database, update its binding and your route in
`wrangler.jsonc`, and apply migrations to that database before deploying. Do not
point a fork or preview at the production Sirona database. Backups and migration
checks are still required when updating an existing installation.
