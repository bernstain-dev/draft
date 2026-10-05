# MedicAppointment Phase 1 remediation

Timestamp: 2026-10-02T20:34:37+08:00 (Asia/Manila)

Status: **IMPLEMENTED IN WORKSPACE; LOCAL VERIFICATION PASSED; NOT DEPLOYED**.

## Scope and deployment boundary

Phase 1 addresses audit **E1 / CRITICAL: patient-to-admin role escalation**, **E2 / CRITICAL: unrestricted appointment mutations**, and the shared backend appointment authorization needed to close those vulnerabilities. It also hardens the relevant SECURITY DEFINER functions and preserves the exact-slot unique index.

No hosted Supabase project was contacted, no production records were read or modified, no destructive Supabase command or deployment was run, and no application credentials are reproduced here. Database tests created synthetic records in a disposable PostgreSQL 18 cluster on loopback, with a generated port. No remote database URL or production keys were accepted by that harness. The cluster was stopped and its generated temporary directory removed after each completed run.

The original `MEDICAPPOINTMENT_AUDIT_REPORT.md` remains a historical audit and was not edited. UI redesign, doctor editing, reports, exports, Realtime, notification CORS/providers/reminders, browser timezone conversion and performance optimization remain outside this phase. Existing `.env.example` deletion predates this work and was not changed.

## Original mutation inventory (recorded before source changes)

The audit and current implementation were inspected before editing. These are every appointment-write path found, including backend tools and commented verification examples.

| File | Function/path | Original operation | Phase 1 disposition |
|---|---|---|---|
| `src/pages/patient/BookAppointment.tsx` | `confirmBooking` | `book_appointment`; missing-RPC fallback INSERT, retry without reason; `reschedule_appointment`; missing-RPC fallback UPDATE doctor/time | RPC only; fail closed |
| `src/pages/patient/MyAppointments.tsx` | `cancelAppointment` | `cancel_appointment`; missing-RPC fallback UPDATE status | RPC only; fail closed |
| `src/pages/appointments/Booking.tsx` | `book` | Direct INSERT including source, room, recurrence and created_by; separate visit note | Authoritative staff booking RPC with atomic note |
| `src/pages/appointments/Booking.tsx` | `reschedule` | Direct UPDATE doctor/time | Staff rescheduling RPC |
| `src/pages/appointments/Booking.tsx` | `cancel` | Direct UPDATE status | Staff cancellation RPC |
| `src/pages/appointments/CheckIn.tsx` | `setStatus` | Direct UPDATE status/room | Dedicated check-in, cancellation and status RPCs |
| `supabase/schema.sql` | `book_appointment`, `reschedule_appointment`, `cancel_appointment` | Definer INSERT/UPDATE; incomplete authorization/search_path/privileges | Hardened shared operations |
| `supabase/full.sql` | Same RPCs; demo seed SQL | Definer INSERT/UPDATE plus trusted installation seed INSERT | Same canonical security block; seed data retained |
| `supabase/migrate_patient_booking.sql` | Same RPCs | Definer INSERT/UPDATE and permissive patient/staff policies | Same canonical security block after legacy upgrade |
| `supabase/seed.cjs` | Generic `upsert` helper; appointment seeding | Service-role appointment upsert | Trusted backend bootstrap retained; never executed |
| `scripts/verify.mjs` | Environment-triggered live checks | Patient booking/cancellation RPC; staff direct INSERT and DELETE | Replace with static-only verification; no production mutation |
| `supabase/rls_tests.sql` | Commented manual examples | Direct INSERT, cancellation UPDATE, check-in UPDATE | Read-only catalog checks and corrected expectations |

No additional browser INSERT/UPDATE/DELETE against appointments was found. Notification Edge Functions read appointments; they do not mutate them. Patient profile save and staff display-name save update only `profiles.full_name`; staff Settings `setRole` directly updates `profiles.role` and will use an admin-authorized RPC. Patient auth `signIn`/`signUp` currently INSERT an explicit patient role; these will omit role and use the database default.

## Files changed

| File | Change |
|---|---|
| `supabase/fix_phase1_security.sql` | New transactional, data-preserving migration for an existing post-cleanup project |
| `supabase/schema.sql` | Fresh installation receives column-limited profiles, SELECT-only appointments, hardened RPCs and trigger |
| `supabase/full.sql` | Same corrected schema/security block; existing demonstration seed suffix preserved |
| `supabase/migrate_patient_booking.sql` | Legacy upgrade ends with the identical Phase 1 security block; upgrade is transactional; previously commented-out patient policy DROP corrected |
| `src/pages/patient/auth/patientAuth.tsx` | `signIn`/`signUp` omit role during profile INSERT; `loadAll` only resolves patient identity for an actual patient and clears patient state otherwise |
| `src/pages/patient/BookAppointment.tsx` | `confirmBooking` uses approved RPCs only; fails closed for unloaded reschedule target and RPC failure; verifies successful RPC result |
| `src/pages/patient/MyAppointments.tsx` | `cancelAppointment` no longer has direct UPDATE fallback; controls reflect editable statuses; removed nonexistent confirmed status from query |
| `src/pages/appointments/Booking.tsx` | `book`, `reschedule`, `cancel` use authorized staff RPCs; reason/note save occurs atomically in database; pending appointments remain accessible |
| `src/pages/appointments/CheckIn.tsx` | `setStatus` routes to dedicated check-in/cancel/progression RPCs; pending confirmation supported; no-show control limited to pending/scheduled |
| `src/pages/appointments/Settings.tsx` | `setRole` calls `admin_set_profile_role`; display-name update remains direct and permitted |
| `src/pages/appointments/StaffLayout.tsx` | Guard requires exact admin role |
| `src/pages/patient/PatientLayout.tsx` | Guard requires exact patient role |
| `src/pages/appointments/auth/staffAuth.tsx` | Returned staff role is admin only when loaded profile actually has that role; removed unchecked cast |
| `scripts/verify.mjs` | Existing verification is now strictly offline/static; removed environment-triggered production writes and unsafe fallback expectations |
| `scripts/test-phase1.mjs` | Synthetic local PostgreSQL integration tests, authorization/ACL tests, history preservation and concurrent uniqueness checks |
| `supabase/rls_tests.sql` | Replaced stale direct-mutation examples with read-only policy, privilege, function and index catalog checks |
| `MEDICAPPOINTMENT_PHASE1_FIX_REPORT.md` | Mutation inventory, remediation design, results, limits and manual rollout guidance |

No dependency versions or package files were changed. `npm ci` installed the existing lockfile. The service-role seeder was not run or changed. Notification calls in staff booking were retained without changes to their behavior.

## Database objects and privilege changes

### Profile role protection

`public.profiles.role` now defaults to `patient`. The migration does **not** rewrite existing roles, create users or promote/demote any existing profile. Auth signup metadata is not trusted for authorization.

Authenticated clients receive:

- table SELECT on `public.profiles`;
- column INSERT on `id, full_name` only;
- column UPDATE on `full_name, device_label` only.

There is no authenticated INSERT or UPDATE privilege on `role`, `id` during UPDATE, or other administrative columns. Column-level ACLs are revoked explicitly before safe fields are regranted; revoking a table privilege alone would leave pre-existing column grants behind.

`profiles_insert_own` additionally requires `id = auth.uid()` **and** resulting `role = 'patient'`. Patients may update their own allowed fields under `profiles_update_own`. Administrators can still read profiles and update permitted display fields; role management uses the authorized RPC. The frontend patient profile save (`Profile.save`, `profiles.full_name`) and staff `Settings.saveName` were reviewed and remain compatible with these grants.

`admin_set_profile_role(uuid,text)` requires the caller's **database** role to be admin, only accepts admin/patient, locks the target row, rejects self role changes and records a `role_change` audit event. This preserves Settings role management while closing the same REST/table-write attack available to patients. Bootstrap role assignment remains a trusted database-owner/service-role backend responsibility; service-role table grants are not revoked. No service-role credential was added to frontend code.

### Appointment table protection

Authenticated clients, including staff browser clients, receive SELECT only on `public.appointments`. INSERT, UPDATE, DELETE, column mutation privileges and REFERENCES grants inherited from the prior table configuration are revoked from PUBLIC, anon and authenticated. Only explicit role-checked RPCs mutate appointments through the privileged database owner. Authenticated clients cannot bypass schedules, status transitions, ownership, check-in timestamps or cancellation rules using REST/table mutations.

All pre-existing policies on `profiles` and `appointments` are removed dynamically, including unfamiliar policy names: PostgreSQL permissive policies combine with OR, so removing only named policies would leave legacy bypasses. Other clinical-table policies/grants remain in scope only insofar as they depend on protected database roles; their business behavior is unchanged.

### Final protected-table RLS policies

| Table | Policy | Command | Authorized rows/check | Additional SQL privilege gate |
|---|---|---|---|---|
| profiles | profiles_select_own | SELECT | Own Auth UUID | Authenticated SELECT |
| profiles | profiles_insert_own | INSERT | Own Auth UUID; patient role | INSERT id/full_name only; role defaults patient |
| profiles | profiles_update_own | UPDATE | Own Auth UUID before and after | UPDATE full_name/device_label only |
| profiles | profiles_admin_select | SELECT | public.is_admin() | Authenticated SELECT |
| profiles | profiles_admin_update | UPDATE | public.is_admin() before and after | UPDATE full_name/device_label only; role uses RPC |
| appointments | patient_select_own_appointments | SELECT | Own linked patient ID and actual patient profile role | Authenticated SELECT |
| appointments | staff_select_appointments | SELECT | public.is_admin() | Authenticated SELECT |
| appointments | No mutation policies | INSERT/UPDATE/DELETE | No browser path authorized | No authenticated mutation privileges |

Removed/replaced policies include `profiles_admin_all`, `staff_all_appointments`, `patient_insert_own_appointments`, `patient_update_own_appointments`, and any legacy full-access policies on the two protected tables. There is no replacement unrestricted appointment policy.

### RPCs and functions

All these objects are in `public`; application-table references in definer code use explicit `public.` qualification and caller identity uses `auth.uid()`.

| Function/signature | Change | Authorization and behavior |
|---|---|---|
| is_admin() | Hardened | Reads actual profiles role under safe definer context; RLS helper |
| my_patient_id() | Hardened | Resolves existing patients.user_id link; RLS helper |
| _require_admin() | Added, private | Exact admin role; locks actor profile FOR SHARE |
| _require_patient() | Added, private | Exact patient role plus linked patient; locks actor profile FOR SHARE |
| admin_set_profile_role(uuid,text) | Added | Admin only; whitelist; target row lock; cannot change self; audits role change |
| _assert_slot_bookable(uuid,timestamptz) | Replaced, private | Single authoritative validator shared by both portals |
| book_appointment(uuid,timestamptz,text) | Replaced | Patient identity derived from authenticated caller; fixed scheduled/pre_booked status/source |
| staff_book_appointment(uuid,uuid,timestamptz,text,text,text,uuid) | Added | Admin; existing patient; shared slot checks; validates source and same-patient follow-up parent; derives actor and recurrence flag; atomic note |
| _reschedule_appointment(uuid,uuid,timestamptz,uuid) | Added, private | Shared row-locking worker; NULL owner requires admin; otherwise verifies patient identity/ownership |
| reschedule_appointment(uuid,uuid,timestamptz) | Replaced | Patient wrapper derives own patient; no frontend-supplied patient identity |
| staff_reschedule_appointment(uuid,uuid,timestamptz) | Added | Admin wrapper; shared slot and status checks |
| _cancel_appointment(uuid,uuid) | Added, private | Shared row-locking worker with distinct patient/admin cancellation permissions |
| cancel_appointment(uuid) | Replaced | Patient wrapper; own upcoming pending/scheduled only |
| staff_cancel_appointment(uuid) | Added | Admin; cancels active statuses; retains history |
| staff_check_in_appointment(uuid,text) | Added | Admin; scheduled only; current clinic date; writes checked_in_at; repeated checked-in call is idempotent |
| staff_set_appointment_status(uuid,text,text) | Added | Admin; explicit transition allowlist; dedicated check-in/cancel operations cannot be bypassed through this RPC |
| audit_appointment_changes() | Hardened/replaced | Safe definer context; qualified audit table; existing trigger retained; doctor-only moves also logged as reschedule |
| set_updated_at() | Search path hardened; execution restricted | Existing trigger retained |

Every relevant SECURITY DEFINER function has `SET search_path = ''`. EXECUTE is explicitly revoked from PUBLIC/anon/authenticated for all matching function names/overloads before granting only the known exposed signatures. Anonymous callers cannot execute these functions. Authenticated callers cannot execute private workers, validation helpers or trigger functions. Public staff RPC execution is granted to authenticated as required by Supabase, but **each invocation checks the caller's current database admin role**. A frontend route guard is never the security boundary.

The caller role is held with `FOR SHARE` while privileged actions run, so concurrent demotion cannot bypass the already-established authorization transaction. Target appointment mutations use `FOR UPDATE` to serialize cancellation, rescheduling and clinical status changes on the same row.

### Booking and rescheduling rules

Both patient/staff paths require: authenticated correct role, existing applicable patient, active doctor, non-NULL finite future timestamp, whole-minute instant, no doctor-specific unavailable date, correct Asia/Manila weekday, positive slot duration, a matching schedule grid and enough time before the schedule end. Invalid zero/negative duration rows are not accepted as bookable schedules. This phase retains the pre-existing backend clinic timezone; it does not change browser timezone conversions or schedule CRUD constraints.

Patient booking fixes identity/source/status at the backend; staff booking derives `created_by` and validates selected patient/source/follow-up ownership. Rescheduling requires an upcoming pending/scheduled appointment, locks it, validates its new doctor/time with the same helper, and updates the existing row atomically. Failure or a uniqueness collision rolls the entire operation back, preserving original appointment data and audit history.

### Exact-slot protection preserved

`public.uq_doctor_slot` remains a **unique partial index** on `(doctor_id, scheduled_time)` with predicate `status NOT IN ('cancelled','no_show')`. The migration does not drop/rebuild an existing correct index, and local testing verifies its object OID remains unchanged. It verifies the existing index definition, uniqueness and validity and aborts the transaction for an unexpected definition. If missing, creating the same index fails safely if existing data violates it; no records are automatically deleted or repaired.

The database guarantees at most one protected appointment for a doctor at an exact timestamp, independently of frontend availability checks. Patient/patient, patient/staff, staff/staff and rescheduling all use this same index. Constraint collisions propagate SQLSTATE **23505** with a useful message. Cancelled/no_show rows release their exact slot; completed rows remain indexed. This does not add duration-range exclusion for appointments beginning at different times; that scheduling concern remains outside Phase 1.

### Authorized status transitions

| Existing status | Approved next states/actions | Restrictions |
|---|---|---|
| pending | scheduled; cancelled; no_show; reschedule | Staff confirmation; no_show only once scheduled instant is past; patient cancel/move only upcoming |
| scheduled | checked_in; cancelled; no_show; reschedule | Staff check-in only on appointment clinic date; no_show only past instant; patient cancel/move only upcoming |
| checked_in | waiting; staff cancellation | Clinical progression on clinic date; patients cannot cancel/reschedule |
| waiting | in_progress; staff cancellation | Clinical progression on clinic date |
| in_progress | completed; staff cancellation | Clinical progression on clinic date |
| completed | No new state | Cannot cancel, reschedule or revive |
| cancelled | No new state | Cannot check in, complete or revive |
| no_show | No new state | Cannot check in, complete or revive |

Same-state permitted status retries return success without performing another mutation. Repeating check-in while already checked_in preserves the first timestamp and does not write another audit event. The dedicated cancellation operation rejects terminal rows; appointment rows and their history are retained.

## Vulnerabilities fixed in workspace

| Audit finding | Severity | Fix | Verification boundary |
|---|---|---|---|
| E1: self INSERT/UPDATE profiles.role | CRITICAL | Column ACLs, patient default/INSERT check, private role authority and admin role RPC | CONFIRMED with local PostgreSQL roles/RLS; hosted database NOT VERIFIED |
| E2: patient arbitrary appointment fields/status | CRITICAL | SELECT-only table grants, no mutation RLS, ownership/role-checked RPCs | CONFIRMED direct writes and privileged RPC abuse rejected locally |
| Staff direct booking/rescheduling bypass | CRITICAL authorization prerequisite | Staff RPCs call the same authoritative slot validator | CONFIRMED invalid/past/inactive/unavailable/off-grid instants rejected locally |
| Reviving terminal appointments/invalid progression | HIGH | Explicit backend transition allowlist and row locks | CONFIRMED locally |
| Missing-RPC fallback bypass | HIGH | Removed all browser INSERT/UPDATE fallbacks; fail closed | CONFIRMED source checks and build; browser session behavior NOT VERIFIED |
| Definer search_path/default public execution | HIGH | Empty search_path, qualified tables, explicit EXECUTE ACLs | CONFIRMED catalog/anonymous/private-helper/shadowing tests |
| Truthy staff role guard | HIGH defense-in-depth | Exact patient/admin checks; no unchecked staff role cast | CONFIRMED source/build; not relied upon for database security |

## Tests and checks performed

Dependency installation: `npm ci --ignore-scripts --no-audit --no-fund` succeeded (146 packages). Existing locked dependency versions were used; no additional dependencies, secrets or package/lockfile edits were required. Lifecycle scripts were disabled. The build successfully used the installed toolchain.

`npm run build` succeeded: TypeScript `tsc --noEmit` and Vite production compilation (102 modules). **No TypeScript/build errors.** Vite reports a non-blocking warning that a minified chunk exceeds 500 kB (approximately 505.51 kB); performance work was deliberately deferred.

`node scripts/verify.mjs` succeeded: **42 offline static checks**; no Supabase connection or environment-driven mutation branch remains.

`node scripts/test-phase1.mjs` final expanded run: **25 checks passed**. This includes all A-G requirements, pending/no-show transitions, and concurrent requests whose winning transactions remain open so competing slot checks overlap. The generated cluster was stopped and removed successfully. All database activity was synthetic and local.

| Required check | Evidence/result |
|---|---|
| A. Patient cannot become admin | Direct role UPDATE, signup INSERT with admin role and admin role RPC rejected; actual role remains patient |
| B. Patient allowed profile updates still work | Own full_name/device_label update succeeds; editing another patient's profile produces no rows |
| C. Patient cannot set clinical appointment statuses | Direct checked_in/completed/cancelled/scheduled UPDATE denied; private/staff functions enforce authorization |
| D. Patient booking still works through approved operation | Successful patient RPC stores caller-derived patient/actor, fixed scheduled/pre_booked fields; another patient cannot read/cancel/move it |
| E. Staff booking uses authoritative validation | Successful staff RPC; atomic visit reason/note; same invalid slot rejections as patient RPC; patient denied staff RPC |
| F. Exact duplicate remains blocked | Unchanged index identity; sequential RPC and trusted direct duplicates rejected; concurrent patient/patient, patient/staff, staff/staff and move/move requests have exactly one winner |
| G. Existing appointments remain preserved | JSON snapshots before/after migration and repeated migration are identical for profiles, patients, doctors, schedules, appointments, notes and audit rows |

Other coverage: default-role registration with own patient linkage; missing patient fails closed; admin role assignment works; admin self-demotion/invalid roles denied; authenticated staff direct appointment writes denied; fresh schema/full.sql execute in empty local databases; legacy migration executes/repeats and rejects a clean-schema invocation; reschedule conflicts preserve the entire original row; cancellation retains cancelled row, history and permits rebooking; future check-in rejected; first check-in timestamp retained on duplicate call; valid clinical progression works; invalid terminal transitions denied; anonymous/private EXECUTE denied; temporary-table search_path spoofing cannot make a patient admin; service-role table privileges are preserved.

An initial test-harness assertion incorrectly expected the legacy upgrade to reject a repeat invocation. Inspection confirmed historical queue columns are intentionally retained, making that upgrade repeatable; the assertion was corrected to verify repeatability and separately verify rejection on a clean schema. This was a test expectation correction, not a schema/data preservation failure. An expanded negative transition test also initially used an error-message matcher that did not include the correctly rejected check-in response (`Use the authorized check-in or cancellation operation for that action.`); the matcher was corrected and the entire expanded suite rerun successfully. Neither test-harness correction required weakening the backend checks.

`git diff --check` passed. No production integration test, seed tool, Supabase reset, hosted migration or deployment was executed. Synthetic cluster initialization/teardown is confined to the harness-generated temporary directory and does not touch real records.

## Data preservation and compatibility

The new migration consists of transactional locks, defaults, policies, grants, function definitions, function ACLs and the existing unique index validation. It contains no top-level appointment/patient/doctor DELETE, TRUNCATE, replacement, reset or UPDATE of existing data. INSERT/UPDATE statements inside function bodies only execute when subsequently invoked by authorized actions.

Existing UUIDs, timestamps, status history, patient/Auth links, doctor records, schedule rows, notes, trigger bindings and audit rows survive. No appointment history is erased by cancellation or moving a booking. Existing roles are preserved; because prior escalation may already have occurred, their legitimacy requires private administrator review rather than automatic reassignment that could lock out valid staff.

The legacy upgrade retains its established historical role remapping and queue cleanup behavior; those operations are **not** part of the new post-cleanup Phase 1 migration. Deploy the new migration to a modern existing project, not full.sql/demo seeding. Existing frontend builds with direct staff writes will start receiving permission errors after migration; coordinate the corrected frontend rollout with the SQL change.

## Remaining risks / NOT VERIFIED

- **NOT DEPLOYED / NOT VERIFIED:** the hosted schema, actual grants, function owners, unknown privileged functions, triggers, RLS, index state, custom role memberships and API schema cache. Workspace remediation does not secure a hosted project until manually applied.
- **Existing role compromise:** the new migration prevents new patient escalation; it cannot determine whether an already-admin account was historically self-promoted. Review admin assignments and audit records privately, then use authorized corrections as necessary.
- **Tracked sensitive material / demonstration accounts:** the original audit found tracked `secret.txt` and embedded demo credentials. Values are not reproduced or inspected here. Remove/rotate exposed secrets privately and disable/reset known demonstration accounts before real deployment. The migration does not remediate repository history or credential rotation.
- **Browser auth not exercised:** real Auth signup/email confirmation, session refresh, signout behavior, deployed PostgREST RPC discovery and portal browser flows remain NOT VERIFIED. Exact-role guards are fixed, but the audited listener initialization/races and legacy name-based patient-resolution fallbacks are not comprehensively redesigned in this phase.
- **Availability/privacy:** patient queries still cannot see all other patients' occupied slots. RPC/index protection handles conflicts securely, but the availability UI can advertise a taken slot. A privacy-preserving occupancy API is deferred.
- **Schedule administration:** positive durations are required by booking validation, but schedule CRUD constraints, overlaps and duplicate schedule rows are not repaired. Exact-start uniqueness does not prevent overlapping intervals with different start timestamps.
- **Schedule/blocking races and existing visits:** this phase validates the current schedule/unavailable-date state but does not redesign concurrent administrative schedule/block changes or automatically cancel existing appointments when a day becomes unavailable. The doctor row lock coordinates with active-state changes, not all schedule inserts.
- **Timezone:** backend retains Asia/Manila; browser local conversion inconsistencies remain. No frontend timezone cleanup was attempted.
- **Operational policy:** no-show is permitted only after the scheduled instant; clinical progression is restricted to the current clinic date. Historical correction requires a separately reviewed privileged backend operation, not arbitrary staff/browser updates.
- **Trusted backend boundary:** database owners and service-role integrations retain trusted access and can bypass browser RPC business rules. Never distribute service-role credentials or run demonstration seeders in production. Unknown definer RPCs in the actual hosted project must be reviewed separately.
- **Deferred modules:** notification authorization/CORS/providers/scheduling, reports/exports, Realtime and UI/performance findings are unchanged. Phase 1 does not establish overall deployment readiness.

## Manual Supabase rollout required (not performed)

1. Review this report and `supabase/fix_phase1_security.sql` with an authorized database administrator. Back up the existing database and verify the current installation is the modern post-cleanup schema with patients.user_id, appointment lifecycle columns and audit infrastructure. Review deployed admin profiles and privileged function owners privately.
2. Validate the migration in an isolated/staging project matching deployed configuration. This workspace's synthetic PostgreSQL tests exercise SQL authorization and integrity but do not replace Supabase-specific staging verification.
3. Apply **only** `supabase/fix_phase1_security.sql` for an existing modern project using the database owner/authorized Supabase SQL editor. Do not reset, seed demo records or apply full.sql/schema.sql as a substitute existing-project migration. The migration takes short-lived write locks and is atomic; an unexpected index definition/duplicate-data failure requires review, not automatic data deletion.
4. A genuinely pre-cleanup project should review/use the updated legacy migration instead; it now includes the same Phase 1 block. That legacy upgrade has its existing role/queue compatibility behavior and should not be substituted blindly on a modern database.
5. Coordinate release of the corrected frontend with the migration. Missing RPCs fail closed; stale direct-write clients intentionally lose appointment mutation permission. Refresh PostgREST schema cache using the project's authorized operational procedure if newly added RPCs are not discovered; no schema-cache operation was performed here.
6. Run the read-only `supabase/rls_tests.sql` catalog checks manually after deployment. Verify column grants, SELECT-only appointments, RPC owners, safe search paths, anonymous/private EXECUTE denial and the unchanged unique index. Verify real Auth/portal behavior in staging with nonpatient test identities before real-data use.

Deployment and real patient/account verification remain **NOT VERIFIED**. No application fixes beyond Phase 1 were started.
