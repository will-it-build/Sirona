# GymSpear status — 21 October 2026

## Completed in production

- gymspear.com purchased and active in Cloudflare; registration expires 21 October 2027.
- Existing website has a Cloudflare Worker backend and D1 database; it is not a frontend-only site.
- Resend sending domain gymspear.com verified, region Ireland (eu-west-1).
- Three Resend DNS records installed and verified.
- Sending-only Resend API key restricted to gymspear.com created with approval.
- RESEND_API_KEY and MAIL_FROM saved as encrypted secrets on the existing Worker.
- Sender: GymSpear <no-reply@gymspear.com>.
- Real password-recovery requests sent through the existing live app; Resend reported delivery to the existing owner's recovery inbox. This confirms provider delivery, not inbox placement or completed password reset.

Update: the private-account build and migration are now deployed at gymspear.com
and www.gymspear.com. The old origin remains available for recovery. Public signup
is still closed. The owner's account and all 29 records were verified unchanged;
backups were restored and checked before migration. Six rest-day plans required a
validation compatibility fix, without changing the saved data. The new-domain
GymSpear recovery email was reported delivered by Resend.

## Built, tested and deployed

- Public signup and private user accounts, with signup kept disabled in the release configuration until validation is complete.
- User-scoped workout records, revision conflicts, safe retries and deletion tombstones.
- Draft autosave, offline queue and recovery, and protection against simultaneous editing tabs.
- Password-reset expiry, single use and session revocation.
- Guarded, additive migration retaining the original workout table.
- Responsive web app and home-screen installation support.
- GymSpear text branding in the local build; existing data identifiers preserved.
- 19 backend/sync tests and four Chromium browser flows passed, plus syntax and deployment dry-run checks.
- Production checks with two disposable accounts passed: login, secure cookies, private reads, overwrite/delete protection, idempotent saves, second-device login and logout. Test accounts and their data were removed.
- Original-owner legacy device-cache export is available at the old origin, without automatically assigning those records to any new account.
- Foundation work is tracked in draft PR #6. Production deployment was performed with Wrangler; PR review/merge remains separate.

## Remaining for the public website launch, in order

1. Finish the GymSpear icon/branding pass and check keyboard navigation, contrast, forms and phone layouts.
2. Recover any remaining device-only history at the old origin. Server backup, restore verification and recovery details are complete.
3. Migration complete: 29 records copied to the original owner, with exact contents and account credentials preserved.
4. Domain deployment complete: apex, www and old origin serve the new build over HTTPS. Keep the old origin available until device recovery is finished.
5. Owner should sign in with their existing credentials and review their history. API isolation, saving, second-device login and recovery delivery have passed; user-completed password reset and real-device/offline checks remain.
6. Finish user-facing privacy/account controls: a privacy notice and terms appropriate to the actual service, a contact/support route, email ownership verification, account/data deletion and export review. These are pending work, not already implemented features.
7. Confirm abuse controls, operational monitoring, backup/recovery process and email failure handling for public use.
8. Check installation and core flows on actual iPhone and Android devices, not just Chromium emulation.
9. Finish PR review and the remaining launch checks, then enable public signup. Production two-account isolation has already passed with disposable test accounts.

Use RELEASE.md for the detailed cutover and recovery procedure. Do not revert to
the original shared-record backend once public accounts exist.

## Remaining product work after the account foundation

- Independent weigh-ins with morning/evening context and progress views.
- Meal and protein logging with persistent private records.
- Routine planning and useful feedback across workouts, meals and weight.
- Explicitly authorised, scoped and revocable ChatGPT access to each user's records.
- Native Android and iPhone apps after the website/backend is stable.
- Later exercise demonstrations: looping Blender avatars, static alternatives and written cues.

The name is settled as GymSpear. Further naming searches are not a launch task.

## Encryption boundaries

Server records are encrypted at rest by Cloudflare D1 (AES-256) and transferred
over HTTPS. Account isolation is enforced by the application in a shared database.
There are no separate user-held encryption keys or end-to-end encryption;
authorised administrators can read database records. Offline browser caches and
local SQL backups are not encrypted by the application. Backup access is restricted
with private filesystem permissions and backups are excluded from git.
