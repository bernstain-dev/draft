# MedicAppointment Phase 4 read-only report authorization fix

Date: 2026-10-03 (Asia/Manila).

## Investigation recorded before implementation

Read the audit and Phase 1–3 reports, the existing Phase 4 continuation/final
verification report, and related SQL/test evidence. The workspace already has
uncommitted work from those phases; this fix preserves it.

Frontend call chains verified in the current source:

- `/appointments/dashboard`: `Dashboard.tsx:58` monthly calendar query →
  `sb.rpc('staff_appointment_report', { p_from, p_to })`.
- `/appointments/reports`: `Reports.tsx:30` totals/filter query →
  `staff_appointment_report`; `Reports.tsx:36` audit query → `staff_report_audit`.
- The dashboard day list uses a SELECT-only appointments query with RLS and
  `is_admin()`; it does not invoke the locking admin guard.
- These pages do not invoke notification RPCs.

Failure chain with the older report authorization definitions:
`staff_appointment_report` / `staff_report_audit` (STABLE, SECURITY DEFINER) →
`_require_admin()` → `SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()
FOR SHARE` → PostgreSQL rejects row locking in a read-only transaction.
`_require_admin()` itself is VOLATILE; it is retained for protected writes.

Important baseline distinction: both current workspace report definitions
already call the lock-free Phase 1 `is_admin()` predicate. The pre-existing
`supabase/fix_admin_reports_readonly.sql` and
`scripts/test-admin-reports-readonly.mjs` implement/test that earlier fix.
Before editing, that test passed all five groups: it reconstructed the older
locking definitions, reproduced the exact reported error in both RPCs under
`BEGIN READ ONLY`, then verified the current patch. This is a controlled local
reproduction, not proof of which definitions are installed on hosted Supabase.

The wider inspection also found `admin_patient_duplicate_count(text,date,text)`:
a SELECT-only RPC still calling `_require_admin()`, declared VOLATILE by default.
It needs the same lock-free authorization for genuinely read-only execution.

Hosted database definitions, real JWT/Auth/PostgREST transactions and the user's
live error are NOT VERIFIED. No hosted connection, migration or deployment is
authorized or performed. A stale hosted report definition is consistent with
the error but remains an inference until an authorized operator inspects it.

## Implementation

Created `supabase/fix_phase4_readonly_report_auth.sql`. It is an incremental,
transactional, repeatable migration for the installed Phase 1–3 schema. It
creates/replaces only a private helper, three read RPC definitions and their
explicit function execution ACLs. It contains no table/policy/index changes,
data cleanup, historical replay, role reassignment or reset.

`public._require_admin_readonly()` is STABLE, SECURITY DEFINER, with
`SET search_path = ''`. It uses `auth.uid()` and a qualified `public.profiles`
EXISTS query requiring `role = 'admin'`. No UID, missing profile, patient role
and a demoted admin fail closed with SQLSTATE 42501. The profile's existing FK
ties it to a real Auth user. It performs no writes or row locking. EXECUTE is
explicitly revoked from PUBLIC, anon and authenticated: only the definer RPCs
invoke this private helper. The three public RPCs grant authenticated EXECUTE
but check database authorization on every call; anon EXECUTE is revoked.

Both report RPCs retain STABLE, original signatures/defaults, JSON payloads,
complete aggregates, ID grouping, Asia/Manila date limits, filters and paging.
The SELECT-only duplicate count now also uses the private guard and is STABLE;
its validation/matching/count semantics are unchanged. STABLE was not removed
from any report to permit a lock.

Read authorization uses the statement's MVCC snapshot. A demotion committed
after a report snapshot begins need not retroactively cancel that in-flight
read. Protected writes retain Phase 1's actor role lock to serialize concurrent
demotion. Reads still acquire ordinary PostgreSQL table access locks; the fix
removes unnecessary **row** locks, not normal SELECT transaction semantics.

`_require_admin()`, `_require_patient()`, appointment write workers, role
assignment, scheduling, RLS, protected column/table grants and `uq_doctor_slot`
are unchanged. The test compares unrelated function definitions, policies,
table ACL/RLS state and the index OID/definition across this migration.

## Read-only RPC inspection

| Function/path | Finding and disposition |
|---|---|
| staff_appointment_report | Older guard locks; current workspace had an inline is_admin fix. Now uses the private read-only guard. Remains STABLE. |
| staff_report_audit | Same authorization correction; remains STABLE. |
| admin_patient_duplicate_count | SELECT-only but locking/default VOLATILE before this fix. Uses read-only guard and STABLE now. |
| is_admin / my_patient_id | Phase 1 STABLE qualified SELECT-only helpers; unchanged. |
| _clinic_schedule_slots / get_available_appointment_slots / get_available_appointment_dates | STABLE, lock-free SELECT authorization/candidate queries; unchanged. |
| _valid_clinic_text / _valid_clinic_contact | IMMUTABLE validation only; unchanged. |
| notification_result | STABLE SELECT-only result, service-role EXECUTE only, no locking admin guard; unchanged. |
| request_appointment_notification | VOLATILE operational authorization for a notification action, not a report or a read-only transaction entry point; not called by either affected screen. Its existing patient/admin actor locks remain unchanged as explicitly required by the notification scope boundary. |
| Notification queue/claim/finish/delivery operations | Mutating/service operations retain their VOLATILE semantics, locking and authorization. No notification change. |
| Staff appointment, role, linking and date-block mutation RPCs | Keep _require_admin and their existing row locks. |

The targeted test inspects every installed public SQL/PLpgSQL STABLE/IMMUTABLE
function and follows its qualified public function calls, rejecting locking,
writes or VOLATILE callees on those read paths. Extension C functions are not
application RPC source and are outside that source inspection.

## Files changed by this task

| File | Change |
|---|---|
| supabase/fix_phase4_readonly_report_auth.sql | New narrowly scoped existing-database migration. |
| supabase/fix_admin_reports_readonly.sql | Earlier migration filename retained with byte-identical compatible definitions; use the Phase 4 path for this release. |
| supabase/fix_phase3_notifications_reports.sql | Maintained canonical Phase 3 block now contains the private read guard and consistent definitions for the three read RPCs. Notification definitions are unchanged. |
| supabase/schema.sql | Identical updated canonical block for fresh installation. |
| supabase/full.sql | Identical updated canonical block; pre-existing demo suffix preserved. |
| supabase/migrate_patient_booking.sql | Identical block for the maintained legacy path. Existing legacy behavior was not redesigned. |
| supabase/full_demo.sql | Existing generated SQL copy synchronized with the same canonical block; no demo data/account operation executed. |
| scripts/test-phase4-readonly-reports.mjs | Expanded regression based on the prior read-only report oracle. |
| scripts/test-phase4-report-ui.mjs | Actual mounted Dashboard/Reports/StaffLayout with read-only local SQL adapters. |
| scripts/test-admin-reports-readonly.mjs | Earlier test entry point now imports the expanded Phase 4 suite. |
| MEDICAPPOINTMENT_PHASE4_REPORT_FIX.md | This report, including pre-edit investigation and verification evidence. |

No `src/`, package, notification handler, standalone Phase 1/2 migration or
prior report was edited by this task. Phase 1/2 canonical equality checks pass.
All `src/` hashes match the historical Phase 4 release baseline. That historical
baseline/report is preserved, not rewritten to claim this later fix was part
of its earlier frozen release. README/setup differences relative to that
baseline predated this task and were not changed here.

## Targeted security and frontend tests

`node scripts/test-phase4-readonly-reports.mjs` uses a disposable loopback
PostgreSQL cluster and synthetic auth/users/clinic records. It never reads
project environment files or falls back to a hosted database. It reconstructs
the locking legacy report bodies and SELECT-only duplicate counter, then
installs the actual incremental patch twice. A controlled cancellation is
rolled back after the concurrency check. The cluster is stopped and its
generated temporary directory removed by the harness.

| Requirement | Evidence |
|---|---|
| A/B/C: admin reports work without FOR SHARE error | Actual authenticated SQL RPCs in BEGIN READ ONLY; exact legacy error reproduced before the fix. |
| D: patient denied | Both reports and duplicate counter fail with 42501; no data returned. |
| E: anonymous denied | Explicit EXECUTE permission denial for all three public read RPCs. |
| F: authorization reads without writes/row locks | Ordered record snapshots unchanged; a second session acquires FOR UPDATE NOWAIT on the actor profile while all three read RPCs' transaction remains open. |
| G: write authorization preserved | A real staff_cancel_appointment transaction still blocks that same NOWAIT actor row lock; rollback preserves the original rows. Unrelated function/catalog snapshots match. |
| H: no patient promotion | Direct profiles.role UPDATE and admin role-assignment RPC denied; qualified helper resists temporary profile shadowing. |
| I: direct appointment mutations denied | INSERT/UPDATE/DELETE denied for both patient and admin browser roles. |
| J: exact-slot protection retained | Index OID/definition unchanged; duplicate trusted insertion rejected by uq_doctor_slot; all Phase 1 sequential/concurrent tests pass. |

Other checks cover missing profiles, missing UID, demotion, invalid date/page
inputs, private helper ACL/search_path, identical maintained canonical SQL
copies, repeated installation and reapplication of the maintained Phase 3
definitions. The report oracle uses 1,211 visits, all eight statuses, distinct
same-name IDs, 1,201 cancellations, four no-shows, three walk-ins, Manila
midnight boundaries, doctor/empty filters and 185 audit entries paged 100+85,
under UTC, Asia/Manila and America/New_York SQL sessions.

Frontend verification mounts the unchanged real components with React's
renderer and a local PostgreSQL adapter that executes the actual report RPCs
in read-only transactions. Only portal identity/client wiring is substituted;
report results are produced by SQL, not fixed JSON totals. It verifies:

- `/appointments/dashboard`: day rows and monthly calendar counts render,
  no lock error banner, normal empty state, real SQL division-by-zero failure
  displayed, and Retry reloads successfully.
- `/appointments/reports`: SQL totals and audit rows render, normal empty
  states, independent totals/audit SQL failures displayed, and both Retry paths
  recover. A patient calling the component receives backend denial.
- Real StaffLayout redirects a patient away from both protected routes before
  any report RPC runs.

No frontend error was hidden or suppressed. This verifies mounted component
behavior with real local application SQL, not live Supabase HTTP/Auth or a
hosted browser session.

## Build and regression results

| Requested command | Final result |
|---|---|
| npm run build | PASS, exit 0: tsc --noEmit and Vite 5.4.21, 118 modules; index 1.18 kB, CSS 40.13 kB, JS 521.43 kB (gzip 144.31 kB). |
| node scripts/verify.mjs | PASS, exit 0: all 69 offline static checks. |
| node scripts/test-phase1.mjs | PASS, exit 0: all 25 checks, including local concurrent booking/moving, roles, ACLs, exact-slot integrity and fresh/legacy installs. |
| node scripts/test-phase2.mjs | PASS, exit 0: nine mounted UI/timezone checks, 14 local SQL checks and canonical-copy equality. |
| node scripts/test-phase3.mjs | PASS, exit 0: 19 handler/UI/timezone checks, 15 local SQL checks and canonical-copy equality. Notification providers/scheduler transport remain mocked. |
| node scripts/check-edge.mjs | PASS, exit 0: offline TypeScript checks for seven Edge files. |
| node scripts/test-phase4-readonly-reports.mjs | PASS, exit 0 in the final tightened run: 14 groups (eight SQL/security, six mounted portal checks), including installation with the helper initially absent and inspection of all 12 SQL/PLpgSQL STABLE/IMMUTABLE application functions. |
| git diff --check | PASS, exit 0. Changed/new task files additionally pass a direct trailing-whitespace check. |

Warnings: existing Vite minified chunk exceeds 500 kB; React Router future-flag
warnings occur in mounted tests; Git emits LF/CRLF conversion notices. No
dependency upgrade or warning suppression was introduced.

Initial new-test failures were harness errors: report extraction assumed LF
and identical inter-function spacing, an extraction expression had an extra
parenthesis, and the audit fixture expected the wrong action label. They were
corrected without changing application behavior or weakening authorization.
The final tightened targeted run passed all 14 groups, including installation
with its new helper initially absent and source-call-graph inspection limited
to SQL/PLpgSQL application functions.

## Hosted Supabase and manual migration boundary

**No hosted database was inspected or changed. No automatic deployment was
performed. The live Dashboard/Reports state remains NOT VERIFIED.** Current
workspace reports already had an earlier inline fix before this task; the
remaining lock in duplicate counting was present in workspace SQL. A hosted
database still reporting the stated error may have older report definitions
or drifted helpers. That explanation is an inference, not a verified catalog
inspection.

For the existing compatible project, after review, the intended manual fix is
**only `supabase/fix_phase4_readonly_report_auth.sql`**, applied as the authorized
database owner. Check installed function owners and Phase 1–3 prerequisites;
the private helper must be callable by the report/duplicate definer owners.
Do not use `schema.sql`, `full.sql`, `full_demo.sql`, the legacy fresh/upgrade
path, demo seeding or `supabase db reset` on this existing hosted project.
Reapplying the entire Phase 3 migration is not required for this fix.

An authorized operator can inspect the installed definitions without reading
patient records:

```sql
select pg_get_functiondef('public.staff_appointment_report(date,date,uuid)'::regprocedure);
select pg_get_functiondef('public.staff_report_audit(date,date,text,integer,integer)'::regprocedure);
select pg_get_functiondef('public._require_admin()'::regprocedure);
select pg_get_functiondef('public.is_admin()'::regprocedure);
```

After manual application, verify the new private helper/ACLs and both report
RPCs as a synthetic admin, patient and anonymous caller; refresh the PostgREST
schema cache through the project's normal authorized procedure if its changed
duplicate-count volatility remains stale. Reload both affected pages and
verify data, empty states and Retry through actual Auth/PostgREST.

Remaining NOT VERIFIED: deployed definitions/owners/custom grants, actual
JWT/Auth/PostgREST transaction configuration and cache, hosted page recovery,
real browser end-to-end behavior and real clinical data. Local tests preserve
Phase 1–3 protections but do not establish that this migration is installed
on Supabase. Stop after this bug fix; no unrelated Phase 4 or deployment work.
