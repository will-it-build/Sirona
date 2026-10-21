# Public web app foundation

Agreed scope: public sign-up, private accounts, reliable workout saving,
desktop/mobile use and home-screen installation. GymSpear is live at gymspear.com;
the old origin remains available for device-data recovery. Public signup is closed.

Name selected: **GymSpear** (21 October 2026). Website and backend first;
Android and iPhone native apps follow later. **gymspear.com** is registered and
active in Cloudflare (expires 21 October 2027). Keep the existing production database, account identifiers and
browser storage keys compatible throughout the rebrand.

Product brief: a sustainable routine, dependable workout records, useful feedback
and clear progress. Independent weight and meal/protein logging and authorised
ChatGPT access remain follow-on work after the account foundation is released.

Email provider: Resend. gymspear.com is verified in Ireland (eu-west-1), with
all three sending DNS records verified. A sending-only API key restricted to
gymspear.com is stored as the encrypted RESEND_API_KEY secret on the existing
Cloudflare Worker. MAIL_FROM is configured as GymSpear <no-reply@gymspear.com>.
On 21 October, Resend reported recovery emails from the existing live app as
delivered. Recovery delivery was also verified from the new GymSpear build/domain.
Owner sign-in and user-completed password reset remain manual checks.

- [x] Inspect current source and live unauthenticated behaviour.
- [x] Implement and test the guarded, additive legacy-history migration (applied and verified in production).
- [x] Implement public accounts and user-scoped records.
- [x] Implement revision-based sync, deletion tombstones and draft autosave.
- [x] Add mobile installation and accessible status/recovery controls.
- [x] Test migration, isolation, concurrent/offline saves and browser flows.
- [x] Verify repository/hosting credentials and prepare the maintenance cutover procedure.
- [x] Configure Resend and verify provider-reported recovery email delivery from the existing live backend.
- [x] Back up production, migrate, deploy and verify recovery delivery on the new build/domain.
- [ ] Check home-screen installation on real iPhone and Android devices.
- [x] Choose GymSpear as the product name.
- [x] Confirm registered domain gymspear.com.
- [x] Serve GymSpear over HTTPS at gymspear.com and www.gymspear.com.
- [ ] Retire the old origin only after any device-only history has been recovered.

Later: independent morning/evening weigh-ins, meals/protein, routine support
and a scoped, revocable ChatGPT integration. Personal measurements must never
be seeded into shared source code or treated as a different measurement type.

Deferred exercise demonstrations: short looping Blender animations with male
and female avatar options. Add optional demonstrations to the exercise picker
and assigned workouts, opened on demand. Include a static fallback, reduced-motion
support and written cues; confirm rights and review movement accuracy before
publishing. Custom exercises may have no demonstration. No media generation is
authorised by this roadmap entry.

Release gates: verified database ownership migration; production backup;
working account-recovery email delivery; passing isolation and browser tests;
hosting credentials. Domain purchase/selection remains a user decision.

Local validation: 19 backend/sync tests and 4 Chromium browser flows pass.
Syntax checks and deployment dry run pass. Automated email tests use mocks;
real delivery from the new domain is verified by Resend. The production migration
preserved all 29 records and the existing account. Live API isolation and saving
checks passed with disposable accounts, subsequently removed. See RELEASE.md and STATUS.md.
