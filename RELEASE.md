# Release and recovery procedure

Status: implementation tested locally; no production migration or release has
been performed for this branch. Email sending and the new domain remain pending.
The existing name and route are unchanged.

## Before the release window

1. Complete `npm test`, `npm run check`, `npm run test:browser` and
   `npm run deploy:check` on the exact release revision.
2. Verify Resend's chosen sending domain, store the API key and sender as Worker
   secrets, and test an authorised recovery email through the deployed app before
   enabling public signup. Do not put credentials in git, shell arguments or logs.
3. Export the existing app's local history from every device that may have unsynced
   edits. Retain those exports privately. Unsynced browser data is not in D1.
4. Confirm the migration has an unambiguous owner. It deliberately stops if legacy
   sessions exist without exactly one account. If ownership is ambiguous, make an
   explicit mapping before migration rather than weakening the guard. Normalized
   duplicate usernames/emails must also be resolved before migration.
5. Record the current Worker deployment/version and current D1 recovery details.
   Keep a copy of the new build available for maintenance recovery.

## Freeze, back up and migrate

The new Worker can serve maintenance responses before the new schema exists:

```sh
npx wrangler deploy --var MAINTENANCE_MODE:true --var PUBLIC_SIGNUP:false
```

Check that authenticated and unauthenticated API calls return 503. The app shell
may still load. Allow in-flight requests from the old deployment to finish, then
verify that the legacy session count and latest update time are stable before
exporting. No old writer may remain active during the copy.

```sh
mkdir -p backups
npx wrangler d1 export sirona-db --remote --output backups/pre-accounts.sql
npx wrangler d1 migrations list sirona-db --remote
npx wrangler d1 migrations apply sirona-db --remote
```

Treat the export as sensitive account and workout data. Restrict access, keep it
outside git and verify it can be restored into a separate local database before
continuing. The migration preserves `sessions` and copies its records into
`records` under the single existing owner. Verify equal counts, matching JSON
payloads and owner IDs while maintenance remains enabled. Do not just rely on a
successful command exit.

The additive migration should be applied once through Wrangler's migration
ledger, not by repeatedly executing the SQL file manually. A fresh database also
starts from this migration. `schema.sql` is historical documentation only.

## Verify, then open signup

Deploy with `MAINTENANCE_MODE=false` and `PUBLIC_SIGNUP=false` (the checked-in
defaults). Check existing-account login, migrated history, draft refresh, finishing
a workout, deletion and offline reconnect. Test the recovery flow to an authorised
inbox, including expiry/reuse behaviour and revoked sessions. Confirm errors do
not log request bodies, passwords, cookies or reset links.

Once recovery delivery and migration checks pass, set `PUBLIC_SIGNUP` to `true`
in the reviewed configuration and deploy. Create two dedicated test accounts;
verify neither can read, overwrite or delete the other's records. Remove only the
known test records/accounts using a reviewed procedure. Never delete real records
to clean up a test. Check iPhone and Android installation on actual devices.

## If something goes wrong

Deploy the new build with `MAINTENANCE_MODE=true` to stop API reads and writes while
investigating. Preserve the current database before restoring any backup. Fix
forward or restore a verified snapshot in a controlled release window.

Do not roll back to the original shared-record Worker after public accounts are
created: that Worker does not enforce ownership. A database rollback after new
writes can lose those writes; export and reconcile them before any restore. The
legacy table is a pre-migration recovery source, not a live mirror of new records.

## Later domain move

Choose/register the new domain, attach it to the Worker, verify TLS and Resend DNS,
and test login and reset links at that origin. Export/sync pending changes at the
old origin before redirecting it. Browser storage, cookies and installed web apps
do not transfer between domains; users must sign in and reinstall at the new
address. Keep access to the old origin long enough to recover pending local data.
