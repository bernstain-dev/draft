# MedicAppointment setup and staging guide

This guide separates local development, fresh installation and incremental upgrade. Do not reset a database, use real patient data in tests, or run demonstration seeders against hosted services.

## Tools and local checks

Use Node.js 24+ for the safe test suites, npm and Git. PostgreSQL 18 `initdb`, `pg_ctl`, and `psql` are used for local synthetic integration tests; they must be on PATH, or `PG_BIN` may name their local directory. Tests bind their temporary clusters to loopback, stop them and remove only their verified temporary directories. There is no remote database fallback.

Run `npm ci --ignore-scripts --no-audit --no-fund`, copy `.env.example` to `.env`, fill the public frontend values and run `npm run dev`. Run the build/static/Phase 1/2/3 commands in README for verification. The npm build uses `&&`, not the obsolete semicolon separator.

## Frontend configuration

| Variable | Required | Handling |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Public endpoint |
| `VITE_SUPABASE_ANON_KEY` | Yes | Public anon credential only |
| `VITE_NOTIFY_ENABLED` | Optional | Default false; true permits browser invocation of already configured notification functions |

Vite embeds public `VITE_*` values in its bundle. Never prefix a service-role credential, cron secret or provider secret with `VITE_`. Never copy an existing private `.env` into the example. The supplied example is fake.

## Fresh and existing databases

For a fresh application database, review and install `supabase/schema.sql` with the intended database owner in an isolated staging project first. It includes the canonical Phase 1, 2 and 3 definitions. Create real Auth accounts independently; bootstrap the first administrator with an explicitly reviewed trusted backend/database operation. Existing administrators can use `admin_set_profile_role` for other accounts. Patients cannot promote themselves, and an admin cannot self-demote through the application RPC.

For an existing post-cleanup project, review and apply these incremental files **in this order**:

1. `supabase/fix_phase1_security.sql`
2. `supabase/fix_phase2_booking_availability.sql`
3. `supabase/fix_phase3_notifications_reports.sql`

For an already installed version whose Admin Dashboard or Reports fails with `cannot execute SELECT FOR SHARE in a read-only transaction`, run [supabase/fix_admin_reports_readonly.sql](./supabase/fix_admin_reports_readonly.sql) in SQL Editor and refresh the affected page. It updates only the two report RPC definitions and their execute permissions. Current Phase 3 and fresh-install files include the correction; no data reset or demo import is needed.

Use `migrate_patient_booking.sql` only for the matching legacy schema; it converges through the same canonical blocks. Do not rerun fresh schema SQL over an arbitrary deployed database as an upgrade. Preflight failures preserve data and require private, authorized review; they do not justify deleting or silently normalizing real records. Back up and assess locks/ownership/RLS drift in staging before a later separately authorized production rollout.

`full.sql` is a schema-plus-demo convenience file for disposable local demonstrations only. `seed.cjs` also provisions demonstration identities/data and now refuses non-loopback URLs. Do not bypass that guard with a tunnel. Its fixed demonstration identities are unsuitable for a real deployment; remove/rotate any already deployed demonstration accounts. No example username/password is reproduced in this guide.

## Patient identity management

Registration provisions a patient-only profile and at most one patient row for the exact Auth UUID. Names are display data, not proof of identity. Clinic-created records stay unlinked until an authorized admin verifies identity outside the app and uses Patients → Link Auth identity. The form identifies the clinic record, requires an exact UUID and verification/confirmation, and surfaces backend conflicts.

Link before first portal provisioning where possible. If the Auth account already owns another patient record, the function refuses: it does not merge/delete histories. Review actual identity outside the app and use a separate authorized reconciliation plan if needed. Never paste service-role credentials into this form.

## Edge Function configuration

| Variable | Required / purpose |
|---|---|
| `SUPABASE_URL` | Runtime project endpoint |
| `SUPABASE_ANON_KEY` | Runtime public key for verifying the caller through Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only worker RPC access; never frontend |
| `CRON_SECRET` | Strong independent server secret matching the named Vault secret |
| `NOTIFY_ALLOWED_ORIGINS` | Comma-separated exact frontend origins; no wildcard, no trailing path; unset means browser origins are refused |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Server-only SMS provider configuration |
| `NOTIFY_STATUS_CALLBACK_URL` | Optional exact public HTTPS callback URL for signed delivery tracking |

Runtime Supabase variables may be platform supplied; verify availability in staging. Provider secrets are entered through the platform secret manager, not repository files. No email column/channel is wired; do not assume configuring a Resend key enables email.

Review `supabase/config.toml`: gateway `verify_jwt=false` permits preflight/custom scheduler/webhook authentication. `send-confirmation` itself verifies the real Auth JWT and calls an ownership/role-authorized SQL operation; reminders require the server cron secret; delivery callbacks require a valid provider HMAC. Turning gateway verification off is not removing handler authorization.

Deployment, if later authorized in staging, comprises the three reviewed function entries `send-confirmation`, `send-reminders`, `notification-status`, the Phase 3 database migration, exact origin configuration, and optional callback URL. `VITE_NOTIFY_ENABLED=true` should follow successful staging verification, not precede it. A booking is never rolled back merely because notification processing fails.

## Scheduler and Realtime

Read [NOTIFICATIONS.md](./supabase/NOTIFICATIONS.md). Enable the Supabase Vault/pg_cron/pg_net capabilities in staging and securely configure the three required Vault names; then review `fix_phase3_scheduler.sql`. It installs one named five-minute worker, not a plaintext credential template. Tomorrow's clinic date and the 07:00 Manila reminder gate are calculated in SQL, independent of cron/runtime timezone. The job also drains booking/reschedule/cancellation notices. Automatic execution is unverified until it is deliberately installed and exercised.

For the advertised staff cross-client updates, review `enable_phase3_realtime.sql` in staging. It adds only appointments to the existing publication, preserves default replica identity, and does not change RLS. The staff provider owns one subscription and unsubscribes on role/identity/unmount. Test two synthetic admin sessions and patient isolation against the actual hosted publication. Do not assume local mock event tests establish live Realtime delivery.

## Staging checklist and unresolved operational work

- Verify Phase 1/2 privileges, exact-slot index, all definer search paths, new ledger RLS/service ACLs, and complete report results beyond the REST row cap.
- Configure hosted Auth email/password policies. The app requests at least eight characters; the actual Auth service policy and real password/email-confirmation flows must be verified independently.
- Exercise notification OPTIONS/errors, own patient/admin authorization, failed provider requests, duplicate calls, stale/rescheduled/cancelled reminders and signed callbacks with synthetic provider endpoints/accounts first.
- Verify actual SMS acceptance/delivery, webhook signature URL/proxy handling, callback retry behavior and Supabase scheduler response status. Check ledger backlog/unknown holds privately. Never automatically resend an ambiguous accepted-or-timeout attempt.
- Test CSV exports in the intended spreadsheet applications. Dangerous text is apostrophe-prefixed before CSV quoting; consumers may visibly retain that safety prefix. Unicode is retained with a UTF-8 BOM.
- Remove/rotate any deployed demo accounts. `secret.txt` is still tracked; ignore rules alone do not sanitize Git history. Privately review/rotate/remove it in a reviewed follow-up; no history rewrite was performed here.

No production migration, deployment, reset, provider send or hosted seeder was performed by remediation.
