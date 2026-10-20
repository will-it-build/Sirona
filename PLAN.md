# Public web app foundation

Agreed scope: public sign-up, private accounts, reliable workout saving,
desktop/mobile use and home-screen installation. Keep the existing name and
domain until the user chooses replacements.

Naming/product brief: renewal leads, supported by confidence and pride. Connah wants a clear
record of fitness progression, useful feedback and explanations, and planning
that helps show what to do next. No new name or domain has been selected.

The proposed name “Fit Shark” has existing fitness-app uses, including FitShark
and FitShark+ in Apple's App Store. Naming is pending reconsideration; this is
a product-discovery finding, not a trademark determination.
Email provider: Resend free plan. User created an account. Wait for the new
domain before configuring sending DNS. No sending DNS changes were authorised
for the existing address.

- [x] Inspect current source and live unauthenticated behaviour.
- [x] Implement and test the guarded, additive legacy-history migration (not yet applied in production).
- [x] Implement public accounts and user-scoped records.
- [x] Implement revision-based sync, deletion tombstones and draft autosave.
- [x] Add mobile installation and accessible status/recovery controls.
- [x] Test migration, isolation, concurrent/offline saves and browser flows.
- [x] Verify repository/hosting credentials and prepare the maintenance cutover procedure.
- [ ] Verify live recovery email, back up production, migrate and deploy.
- [ ] Check home-screen installation on real iPhone and Android devices.
- [ ] Choose new name/domain with Connah, then plan the domain transition.

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

Local validation: 17 backend/sync tests and 4 Chromium browser flows pass.
Syntax checks and deployment dry run pass. Email delivery is mocked in tests;
Resend DNS/credentials and a real recovery email remain release gates. See RELEASE.md.
