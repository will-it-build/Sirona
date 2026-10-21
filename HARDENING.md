# GymSpear security hardening plan

Status: proposed implementation sequence, not completed security features.
Keep public signup disabled until the launch gates below pass.

## 1. Reduce the amount of private data retained on devices

Add a clearly explained trusted-device/offline preference. On shared devices,
avoid persistent workout storage. On logout, clear synced local copies by default;
never silently remove pending changes or conflicts. Provide safe sync/export and
explicit choices before clearing those. Account switching must not show the
previous user's history. Explain that signing out currently leaves the offline
cache behind; the app's existing help text now does so.

Acceptance: tests for offline logout, failed sync, conflicts, account switching,
failed local writes and cache removal. No pending workout lost in any path.
Encryption with a key stored next to the data does not solve the shared-device
problem. A passcode-based offline lock requires recovery and key-lifetime design.

## 2. Upgrade authentication without locking out the owner

Use a versioned hash format so existing passwords can be verified and upgraded on
successful login or reset. Verify the intended algorithm/cost in the deployed
Workers runtime before changing production. OWASP recommends Argon2id, or 600,000
iterations for PBKDF2-HMAC-SHA256. Current application uses 100,000 iterations.
Cloudflare workerd has an open proposal to raise its default 100,000 iteration cap;
a passing local Node/Wrangler test alone is not evidence of production support.
Do not simply increase the current constant or invent a chained-hash workaround.
Benchmark an established supported implementation or evaluate a managed identity
service with a compatible migration path before selecting one.

Add email ownership verification, passkeys or MFA and a device/session list with
revocation. Scope verification tokens to purpose and account, expire them, and
consume them once. Do not send verification messages without the relevant user
signup/verification request.

Acceptance: legacy login, upgrade-on-login, reset, wrong password, revoked session,
token replay and concurrent reset tests. Existing records retain the same owner ID.

## 3. Tighten browser protections

Replace inline handlers with explicit listeners or a restricted action dispatcher;
do not use eval/Function to interpret handler strings. Remove unsafe-inline from
script-src only after conversion, including generated workout/plan controls.
Keep text escaping and validate imported records. Test notes and names containing
markup/quotes, all forms, keyboard navigation and offline updates under strict CSP.

## 4. Limit administrative and operational access

Require MFA on GitHub, Cloudflare and Resend administration; verify configuration
with the owner rather than assuming it is enabled. Use minimal token permissions.
Review who can read D1 and deploy Workers. Keep logs free of passwords, reset
links and workout payloads. Encrypt exported backups separately and define
retention/deletion rules, while retaining a tested restore path. Enforce per-user
record limits and request throttling, with alerts for abnormal authentication,
record errors and failed recovery email delivery.

Acceptance: isolation regression tests, restore drill, sanitized logs, rate-limit
and email-failure tests. Restrict account/data deletion to reauthenticated owners
and check the consequences for backups and pending devices.

## 5. Independently review before public launch

Review authentication, authorization, offline storage, reset flows, account
lifecycle and dependency risks. Run actual iPhone and Android checks. Fix findings
before signup is enabled; document remaining limitations rather than claiming
complete security. Scope any external paid assessment separately.

## End-to-end encryption decision

Cloudflare's managed database encryption and application account isolation do not
prevent an authorized administrator from reading records. Minimize that access
now. Preventing it cryptographically requires encryption on the user's device with
keys unavailable to the service. That changes recovery, cross-device access,
server-side progress processing and authorized ChatGPT sharing. Design these
flows explicitly before promising E2EE; per-user server-managed keys alone do not
make the service end-to-end encrypted.

Sources checked 21 October 2026:
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html
- https://github.com/cloudflare/workerd/pull/7550 (open proposal, not shipped proof)
- https://developers.cloudflare.com/d1/reference/data-security/
