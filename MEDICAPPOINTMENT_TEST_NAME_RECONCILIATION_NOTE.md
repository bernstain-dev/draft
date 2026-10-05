# Blank-name correction for confirmed test data

Date: 2026-10-03 (Asia/Manila).

## Observed evidence

The user's hosted Phase 3 migration rejected 14 invalid patient demographic rows. The aggregate diagnostic showed 14 invalid names and no invalid contact numbers, addresses or birth dates. A second read-only query confirmed 14 blank names, zero null names, zero names over 300 characters and zero names with control characters. No personal values were requested or displayed. The user previously confirmed this project contains test data.

## Prepared correction — manual use only

`supabase/reconcile_test_blank_patient_names.sql` is an optional narrowly scoped test-data correction, not an incremental application migration. It must be run in its entirety only in the confirmed test project. It assigns `TEST PATIENT <existing patient UUID>` to exactly 14 currently blank names. These are explicit synthetic labels, not recovered names or verified identities.

The transaction locks patients, checks the expected count, rejects other invalid demographics, rejects generated-label collisions and unreviewed UPDATE triggers/rules, and archives only IDs, original blank strings and replacement labels in owner-only `medicappointment_maintenance.blank_patient_name_archive`. It does not copy contact numbers, addresses or birth dates. The archive has RLS enabled and no client policies; privileges are revoked from PUBLIC, anon, authenticated and service_role. A conflicting archive aborts the transaction. Repeating the script with no blank names performs no update.

Only `patients.full_name` is changed. Patient UUIDs, Auth links, valid patient names, profiles, roles, doctors, schedules, unavailable dates, appointments, notes, audit rows and `uq_doctor_slot` are preserved. Phase 1–3 SQL and application files were not modified. Never apply this script to genuine patient records: missing real names require intentional private identity correction, not fabricated labels.

After a successful correction, run the read-only demographic diagnostic again, then retry `supabase/fix_phase3_notifications_reports.sql`. Stop if any new preflight error appears.

## Alternative fresh-install path

If the user instead chooses a fresh disposable project, `supabase/schema.sql` is already the complete non-demo installation script and contains canonical Phase 1, Phase 2 and Phase 3 definitions. No duplicate master script is needed. Use an actually empty application database; do not rerun it as a substitute for correcting an existing database. `full.sql` and `seed.cjs` are not the hosted setup path. Supabase Auth accounts, first-admin provisioning, Edge Function deployment/secrets, optional scheduler and optional Realtime publication are separate setup tasks. Dropping application tables would destroy their history and does not establish a consistent Auth/account reset.

## Verification and limits

`scripts/test-blank-patient-name-reconciliation.mjs` exercises synthetic loopback PostgreSQL fixtures only. Results are recorded in `scripts/blank-patient-name-reconciliation-results.json` when the full suite passes. Checks cover the original Phase 3 rejection; changed counts; invalid other demographics; unknown triggers; label collisions; private backup access; preservation of metadata, histories and the double-booking index; successful subsequent Phase 3 installation; and harmless repeat execution before/after Phase 3.

Hosted correction, hosted Phase 3 completion and hosted Auth/provider/scheduler/Realtime operation remain NOT VERIFIED. No hosted database connection, reset, deletion, automatic migration or seeder execution was performed. The prior release classifications remain subject to the final verification report.
