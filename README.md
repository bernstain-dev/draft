# MedicAppointment

Patient appointment booking and an administrator workspace for a Philippine Rural Health Unit. React 18, React Router 6, TypeScript, Vite 5 and Supabase provide the application. Clinic calendars and appointment display explicitly use **Asia/Manila**.

Read [setup.md](./setup.md) before configuring a database. Current remediation is implemented and tested locally; hosted configuration is not implied by the source files. Phase reports record verification boundaries.

## Portals

| Route | Purpose | Required database role |
|---|---|---|
| `/` | Redirect to patient login | None |
| `/patient/login` | Patient login/registration | None |
| `/patient/dashboard`, `/patient/book`, `/patient/appointments`, `/patient/history`, `/patient/profile`, `/patient/settings` | Own patient workspace | `patient` |
| `/appointments/login` | Admin login | None |
| `/appointments/dashboard`, `/appointments/booking`, `/appointments/check-in`, `/appointments/patients`, `/appointments/doctors`, `/appointments/reports`, `/appointments/settings` | Staff administration | `admin` |

Patient and staff clients retain separate storage keys: `medical-patient` and `medical-appointments-staff`. Both fail closed on unresolved/wrong roles. All appointment mutations use authorized RPCs, and both booking portals use privacy-safe backend availability. `uq_doctor_slot` prevents duplicate active doctor/start timestamps. Cancelled/no-show appointments release their slots; history remains intact.

Doctors support create/read/name/specialty edit and activation/deactivation. Schedules reject overlaps/invalid duration. Blocking a date with conflicting visits is prevented. Patient records use exact Auth UUID links; administrators verify identity and intentionally link through a protected operation. There is no name-based claim, automatic history merge, patient hard-delete control, or doctor hard-delete control.

Reports use complete backend aggregates, Manila dates and immutable IDs; audit entries are explicitly paginated. CSV export neutralizes spreadsheet formulas and preserves Unicode. The frontend has explicit query loading/error/retry states and mutation locks.

Staff Realtime appointment changes feed debounced invalidation after the optional publication configuration is installed. Patients do not subscribe to a global clinical feed. Backend RLS remains the authority.

Notifications use a durable SQL outbox, SMS via Twilio, optional signed delivery callbacks and an authenticated worker scheduler. Provider acceptance is distinct from delivery. No configured provider/contact means **not sent**, not successful delivery. See [supabase/NOTIFICATIONS.md](./supabase/NOTIFICATIONS.md). There is no connected email destination; Resend/email is not claimed as implemented.

## Local development

```text
npm ci --ignore-scripts --no-audit --no-fund
```

Copy `.env.example` to `.env`, fill only the public frontend configuration, then run `npm run dev`. Windows PowerShell uses `Copy-Item .env.example .env`; a POSIX shell uses `cp .env.example .env`.

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Public project endpoint |
| `VITE_SUPABASE_ANON_KEY` | Public anon key; never a service-role key |
| `VITE_NOTIFY_ENABLED` | Browser notification fast path; leave false until the migration/function/CORS configuration is staged |

Server-only secrets belong in Edge Function settings/Vault, never `VITE_*`, source files or browser settings. `.env.example` contains fake placeholders only.

## Database installation and verification

For a new non-demo installation, review `supabase/schema.sql`. For an existing post-cleanup project, apply incremental files in order: Phase 1 security, Phase 2 availability, then Phase 3 notifications/reports. Use `migrate_patient_booking.sql` only for the reviewed legacy upgrade path. Fresh `full.sql` contains demonstration data and is **not a production upgrade or production setup choice**. Scheduler and Realtime publication configuration are separate, deliberate staging operations.

If Admin Dashboard or Reports shows `cannot execute SELECT FOR SHARE in a read-only transaction`, run the entire [supabase/fix_admin_reports_readonly.sql](./supabase/fix_admin_reports_readonly.sql) in Supabase SQL Editor, then refresh the page. It replaces the two report RPCs with a lock-free admin check suitable for read-only queries. Appointment mutations retain their locking authorization check. The patch preserves records and supports repeat execution; current schema and demo installation files already include it. Verify the failure reproduction, patch, report totals and admin-only access with `node scripts/test-admin-reports-readonly.mjs`.

For a complete demo with the two accounts (`vacunawa@gmail.com` and `patient@gmail.com`), run [supabase/demo_data.sql](./supabase/demo_data.sql) in Supabase SQL Editor on the configured demo database. For a fresh application schema, [supabase/full_demo.sql](./supabase/full_demo.sql) includes the entire current schema, Auth account provisioning and the same demo data in one file. Missing accounts are created with confirmed email identities and bcrypt password hashes: `admin123` for the new admin and `patient123` for the new patient. Existing accounts keep their passwords, roles and the patient's exact Auth identity link; mismatched existing profile roles stop the transaction. Edit the email pair in the SQL if your demo accounts differ.

The demo adds 10 doctors (9 active), 70 weekly schedules, 3 blocked dates, 11 additional patient records plus the linked patient, 112 appointments covering all 8 statuses, 81 visit notes, audit entries and 12 explicitly unsent notification samples. Paste the entire updated file into SQL Editor and run it with no partial selection. The data import is one atomic `DO` statement with no temporary tables or session-dependent helper functions; a failure rolls back the complete data import. Dates are relative to the first import in Asia/Manila. Rerunning preserves records and subsequent interactions. Appearance settings remain local to the browser; only the two demo login accounts are provisioned. Regenerate the combined file after schema/data edits with `node scripts/build-demo-sql.mjs`; verify it in disposable local PostgreSQL with `node scripts/test-demo-data.mjs`.

```text
npm run build
node scripts/verify.mjs
node scripts/test-phase1.mjs
node scripts/test-phase2.mjs
node scripts/test-phase3.mjs
node scripts/check-edge.mjs
git diff --check
```

The build script is `tsc --noEmit && vite build` and works through npm on Windows; obsolete semicolon workarounds do not apply. Tests use Node 24's in-memory TypeScript hooks, mounted React tests, synthetic loopback PostgreSQL and mocked provider/scheduler transports. Local PostgreSQL binaries must be on PATH (or `PG_BIN`); missing binaries fail without a remote fallback. No test requires production credentials or records.

## Credential and demo hygiene

`secret.txt` remains tracked in the current repository; its contents were not displayed or assessed during remediation. Adding it to `.gitignore` does not remove already tracked content/history. Privately review it, remove sensitive material from the index in a separately reviewed change, rotate any potentially exposed credentials, and plan history cleanup with collaborators if warranted. No destructive Git history rewrite has been performed.

`supabase/seed.cjs` is a demonstration tool restricted to loopback URLs. Do not use it against a hosted project or a tunnel to a hosted project. Existing demonstration accounts must be removed or their credentials rotated before real deployment. Create real admin identities through trusted Auth/backend administration; never depend on known demo accounts. The login no longer prefills a demonstration email.

Phase 1–3 reports describe local results and manual staging requirements. None constitutes authorization to deploy.
