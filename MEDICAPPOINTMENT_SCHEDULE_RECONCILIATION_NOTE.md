# Confirmed test-data schedule reconciliation

Date: 2026-10-03 (Asia/Manila)

## Scope and authorization

The user confirmed that the Supabase project contains test data and that Monday 08:00–17:00 with 30-minute slots is the intended schedule. This is a narrowly scoped manual correction for the four schedule rows shown in the user's query results, not a general migration or permission to change a production database. No hosted database was contacted by the reconciliation tests or changed by the assistant.

Phase 2 correctly rejected six overlapping pairs among four nested Monday schedules. Phase 3 correctly rejected installation without Phase 2. Neither migration's safeguards were weakened.

## Exact correction

Doctor ID: `58b6b969-6c23-48e2-a53a-86a3a21b5f46`; weekday: `1` (Monday).

| Schedule ID | Existing hours | Action |
|---|---|---|
| `a843e54b-6e38-4c87-bfa8-23d5d3a94507` | 08:00–17:00 | Keep |
| `0ba71514-0449-4a29-a536-cfe95022fc64` | 09:00–17:00 | Privately archive, then remove |
| `434ce046-33ac-4b7a-a1b2-f84933cfd0f1` | 10:00–17:00 | Privately archive, then remove |
| `6427b941-b05e-4c43-8336-45f9983cebe7` | 11:00–17:00 | Privately archive, then remove |

All four rows have 30-minute duration. Keeping the broadest row preserves the 18 unique intended slots, from 08:00 through 16:30.

`supabase/reconcile_test_monday_schedules.sql` locks schedules inside a transaction, checks the exact IDs, doctor, weekday, times, duration and row count, and refuses unexpected referencing foreign keys or DELETE triggers/rules. It records the original three rows in owner-only `medicappointment_maintenance.schedule_reconciliation_archive` before removing them. Archive access is revoked from PUBLIC, anon, authenticated and service_role; RLS is enabled without client policies. Any failed guard rolls back the operation. A repeat execution with the redundant target rows already absent leaves the keeper unchanged.

Patients, doctors, appointments, visit notes and appointment history are not deleted or changed. `uq_doctor_slot` and Phase 1–3 authorization rules remain unchanged. The reconciliation file must not be included in fresh-install SQL or run against another dataset.

## Local evidence — CONFIRMED

Command: `node scripts/test-schedule-reconciliation.mjs` — exit code 0; five checks passed using a disposable loopback-only PostgreSQL environment and synthetic records:

1. The original six overlapping pairs abort Phase 2 without changing schedules.
2. A changed keeper causes reconciliation to abort without deleting schedules.
3. An unexpected foreign-key dependency causes reconciliation to abort without cascading.
4. Exact reconciliation privately archives three rows and preserves the keeper, slot grid, unrelated schedules and every synthetic clinical row.
5. Repeated reconciliation is harmless; Phase 2 followed by Phase 3 installs successfully while preserving clinical rows and the double-booking index.

Evidence: `scripts/schedule-reconciliation-results.json`. Verification script: `scripts/test-schedule-reconciliation.mjs`. The 78 existing release-baseline files remained unchanged; `git diff --check` passed. Application source and the existing migration files were not modified for this correction.

## Manual execution order

Use only the user's confirmed test project:

1. Ensure `supabase/fix_phase1_security.sql` has completed successfully.
2. Copy the **entire** `supabase/reconcile_test_monday_schedules.sql` file into a new Supabase SQL Editor query and run it. Do not execute only its DELETE statement. The result should contain the retained Monday 08:00–17:00 row.
3. Run the entire `supabase/fix_phase2_booking_availability.sql` file.
4. After Phase 2 succeeds, run the entire `supabase/fix_phase3_notifications_reports.sql` file.
5. If any query fails, stop and inspect the exact error. Do not bypass constraints or automatically delete other conflicting records.

## NOT VERIFIED

Hosted reconciliation and migration completion have not been observed. Additional conflicting data elsewhere in the hosted project, hosted Auth/PostgREST behavior, notifications, reminder scheduling and live Realtime remain subject to the existing final verification report. This local correction does not change the release-readiness classifications or constitute deployment verification.
