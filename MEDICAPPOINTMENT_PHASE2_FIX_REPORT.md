# MedicAppointment — Phase 2 Fix Report

Timestamp: **2026-10-02 21:30 Asia/Manila (UTC+08:00)**.

Workspace: `D:\Development\Projects\draft`.

Overall status: **IMPLEMENTED AND VERIFIED LOCALLY; NOT DEPLOYED**.

## Scope and evidence

The existing `MEDICAPPOINTMENT_AUDIT_REPORT.md` and `MEDICAPPOINTMENT_PHASE1_FIX_REPORT.md` were read before implementation, and the current source and SQL were inspected. This phase addresses availability privacy, appointment slot normalization, schedule validity, unavailable-date conflicts, authentication initialization, intentional patient identity linkage, Manila calendar handling, query staleness, mutation refreshes, and the exact-week doctor display.

No production Supabase connection, migration, reset, deployment, destructive integration test, or real-record cleanup was performed. Database verification used temporary PostgreSQL 18 clusters bound to loopback with synthetic records. Those clusters were stopped and their verified temporary directories removed. Secrets and real patient information were not intentionally read or exposed. The audit report, Phase 1 report, and standalone Phase 1 migration were preserved. The pre-existing `.env.example` deletion was not restored or changed as part of this phase.

This report uses **CONFIRMED** for behavior demonstrated by the local tests or inspected source; **PARTIAL** for an implemented workflow with an explicitly stated limitation; **NOT VERIFIED** for deployed Supabase, live Auth, or real-browser behavior that was not exercised. Local verification does not establish that an existing hosted database has received either migration.

## Results

| Requirement | Result | Evidence and limit |
|---|---|---|
| Private availability | CONFIRMED locally | Patient and admin RPC calls return identical available timestamps/durations, exclude another patient's occupied slot, and return no appointment or patient fields. |
| One patient/staff availability rule | CONFIRMED locally | Both booking pages use `useAvailability`; database availability and mutation validation share `_clinic_schedule_slots`. |
| Whole-minute appointments and actual grid | CONFIRMED locally | Backend rejects `09:00:01`, `09:00:00.500`, and off-grid bookings; table CHECK additionally rejects non-minute trusted direct inserts. |
| Schedule validity | CONFIRMED locally | CHECK and GiST exclusion constraints reject invalid, duplicate, and overlapping schedules; adjacent windows remain allowed. |
| Safe unavailable-date workflow | CONFIRMED locally | Admin sees conflict count; conflicting date is not inserted. Direct staff inserts have an equivalent trigger guard. Booking/blocking race is tested. |
| Auth identity consistency | CONFIRMED in mounted React tests | Previous patient is cleared immediately, late identities cannot win, errors finish loading, wrong roles fail closed, listeners unsubscribe. Live Supabase Auth remains NOT VERIFIED. |
| Name-based linkage removed | CONFIRMED locally | Automatic resolution uses only `auth.uid()`/`patients.user_id`; an unlinked namesake stays unlinked. Intentional existing-record linking requires an admin RPC. |
| Manila calendar consistency | CONFIRMED locally | JavaScript and PostgreSQL tests run with Manila, UTC, and New York timezones and produce identical clinic instants/calendar values. |
| Stale query prevention | CONFIRMED in mounted React tests | Late doctor/date responses cannot replace current availability, even when the fake transport ignores abort. Shared generation protection covers patient/filter reads. |
| Staff mutation refresh | CONFIRMED in mounted React tests | Actual staff booking, move, and cancel handlers refresh the visible upcoming list without remount/reload. Check-in/status handlers use the same invalidation helper. |
| Weekly doctor Leave display | CONFIRMED in mounted React tests | This week's actual Monday is distinguished from a blocked Monday four weeks later. |
| Phase 1 regression | CONFIRMED locally | All 25 Phase 1 checks pass with the Phase 2 fresh/legacy schema additions. |
| Hosted integration | NOT VERIFIED | No hosted migration, PostgREST RPC call, email confirmation, browser session persistence, or real deployment was performed. |

## Files changed in Phase 2

The repository already contained uncommitted Phase 1 changes. The following list describes Phase 2 additions/edits, rather than treating every `git status` entry as a new Phase 2 change.

| File | Phase 2 change / principal functions |
|---|---|
| `supabase/fix_phase2_booking_availability.sql` | New transactional upgrade; constraints, privacy-safe availability, calendar guards, safe identity provisioning/linking and explicit function ACLs. |
| `supabase/schema.sql` | Append canonical Phase 2 block in its own transaction, after Phase 1. |
| `supabase/full.sql` | Mirror fresh schema's canonical Phase 2 block; existing seed suffix retained. |
| `supabase/migrate_patient_booking.sql` | Include canonical Phase 2 block before the existing final COMMIT for legacy installs. |
| `supabase/rls_tests.sql` | Add read-only catalog/ACL/constraint checks and aggregate checks for existing blocked-date conflicts and non-minute appointments. |
| `src/lib/clinicTime.ts` | New explicit clinic date, instant, weekday, week, day/month range and display utilities. |
| `src/lib/slots.ts` | Remove React slot generation; retain compatibility exports `toLocalDateKey` and `dayRangeIso` backed by clinic utilities. |
| `src/lib/patient.ts` | Existing patient display helpers now delegate to Manila utilities. |
| `src/lib/asyncState.ts` | New `RequestGeneration`, `IdentityCoordinator`, and atomic `IdentityState`. |
| `src/lib/portalIdentity.ts` | New `resolvePortalIdentity`; patient RPC resolution and exact admin profile validation. |
| `src/lib/usePortalAuth.ts` | Shared initialization/sign-in/sign-up/sign-out/refresh engine with atomic identity, errors and stale-result guards. |
| `src/lib/useClinicQuery.ts` | New keyed query/generation/abort hook and `useAppointmentRevision`. |
| `src/lib/useAvailability.ts` | Shared safe slot RPC hook; revision invalidation and minute refresh for today's slots. |
| `src/lib/appointmentChanges.ts` | `invalidateAppointments`, `appointmentMutationSucceeded`, revision snapshot and subscription cleanup. |
| `src/lib/scheduleValidation.ts` | `scheduleInputError`, `scheduleBackendError` for actionable bounds/duration/overlap errors. |
| `src/components/AuthRecovery.tsx` | Explicit identity-loading error with retry and sign-out. |
| `src/pages/patient/auth/patientAuth.tsx` | Wrap shared engine while retaining patient client/storage key and `refreshPatient` compatibility. |
| `src/pages/appointments/auth/staffAuth.tsx` | Wrap shared engine while retaining staff client/storage key and exact admin role. |
| `src/pages/patient/PatientLayout.tsx` | Explicit auth error/retry handling; protected outlet still requires exact patient role. |
| `src/pages/appointments/StaffLayout.tsx` | Explicit auth error/retry handling; protected outlet still requires exact admin role. |
| `src/pages/patient/PatientLogin.tsx` | Surface initialization/linkage errors and guard login submission. |
| `src/pages/appointments/StaffLogin.tsx` | Surface initialization/role errors and guard login submission. |
| `src/pages/patient/BookAppointment.tsx` | Backend calendar flags and shared slots; keyed doctor/reschedule/schedule reads; successful RPC invalidation; Manila display. |
| `src/pages/patient/MyAppointments.tsx` | Patient-keyed/abortable reads and successful cancellation invalidation. |
| `src/pages/patient/AppointmentHistory.tsx` | Patient-keyed history reads and mutation revisions. |
| `src/pages/patient/Dashboard.tsx` | Patient-keyed reads, revisions, and shared clinic formatting. |
| `src/pages/appointments/Booking.tsx` | Shared slots; keyed patient search/past/upcoming reads; book/move/cancel invalidate every subscribed view. |
| `src/pages/appointments/CheckIn.tsx` | Keyed clinic-day query; check-in/status invalidation and Manila timestamp display. |
| `src/pages/appointments/Dashboard.tsx` | Clinic day/month boundaries, exact clinic calendar grouping and revision queries. |
| `src/pages/appointments/Doctors.tsx` | Schedule errors, conflict-aware `staff_block_doctor_date`, keyed details, calendar invalidation, exact-week dates. Doctor editing was not added. |
| `src/pages/appointments/Patients.tsx` | Key saved search/filter requests so obsolete results cannot replace current rows; CRUD scope unchanged. |
| `src/pages/appointments/Reports.tsx` | Only directly affected shared clinic date/range/grouping helpers and query generation/revision handling. No new reports or export functionality. |
| `scripts/verify.mjs` | Preserve Phase 1 static checks; add 10 Phase 2 architecture checks (52 total). |
| `scripts/test-phase2-ui.mjs` | New mounted real-hook/component tests, controlled Supabase doubles and runtime timezone children. |
| `scripts/test-phase2.mjs` | New canonical-copy checks plus synthetic local PostgreSQL migration/privacy/schedule/linkage/concurrency tests; imports UI suite. |
| `package.json`, `package-lock.json` | Exact development dependency `react-test-renderer@18.3.1` and its transitive dependencies; pre-existing dependency versions preserved. |
| `MEDICAPPOINTMENT_PHASE2_FIX_REPORT.md` | This report. |

`supabase/fix_phase1_security.sql`, `scripts/test-phase1.mjs`, the existing audit/Phase 1 reports, frontend Supabase client factory, router, Edge Functions, notifications, and staff settings were not modified by this phase. Existing Phase 1 canonical SQL was not rewritten. Running the authorized production build generated normal ignored `dist/` output; installing the test dependency updated local `node_modules` and the two package files.

## SQL objects and authorization

All new/replaced SECURITY DEFINER functions use an explicit empty `search_path` and qualified application/auth table references. Execution is explicitly revoked from `PUBLIC`, `anon`, and `authenticated`, then granted back only for the intended public RPCs. Each public RPC verifies the current database profile role or authenticated account. Granting EXECUTE to the common `authenticated` PostgREST role does not make the admin operations available to patients.

| Object | Change / protection |
|---|---|
| Extension `btree_gist` | Enables scalar equality operators in the schedule exclusion constraint. No custom extension credentials or external service. |
| `appointments.phase2_appointment_minute_check` | Requires finite `scheduled_time` and zero seconds, including fractional seconds, in Manila. Validated against all existing rows. |
| `doctor_schedules.phase2_schedule_minutes_check` | Integer duration 1..1440, start before end, zero start/end seconds, and duration fits the window. |
| `doctor_schedules.phase2_schedule_no_overlap` | GiST EXCLUDE on `doctor_id =`, `day_of_week =`, and half-open minute `int4range(start,end,'[)') &&`. Duplicates also overlap. Adjacent ranges do not overlap. |
| `_clinic_schedule_slots(uuid,date)` | New private candidate generator; active doctor, weekday schedules, minute grid, duration/end boundaries, unavailable date and future-time checks. |
| `get_available_appointment_slots(uuid,date)` | New patient/admin RPC; returns only `scheduled_time timestamptz`, `slot_duration_minutes integer`; removes occupied candidates across all patients. |
| `get_available_appointment_dates(uuid,date,integer DEFAULT 30)` | New patient/admin calendar RPC; returns only `clinic_date date`, `available boolean`, for 1..60 days, based on the same slot RPC. |
| `_assert_slot_bookable(uuid,timestamptz)` | Replace private validator while preserving Phase 1 callers; whole-minute/future/active/block validation and exact membership in shared candidate grid. Locks doctor FOR SHARE. |
| `_guard_doctor_calendar_change()` | New private trigger function; locks old/new doctors FOR UPDATE in UUID order and prevents new/moved unavailable dates with conflicting visits. |
| `phase2_guard_schedules` | BEFORE INSERT/UPDATE/DELETE trigger on schedules; serializes calendar changes with booking validation. |
| `phase2_guard_unavailable` | BEFORE INSERT/UPDATE/DELETE trigger on unavailable dates; prevents direct-write bypass of conflict validation. |
| `staff_block_doctor_date(uuid,date,text DEFAULT NULL)` | Admin-only RPC; counts conflicts under doctor lock; returns false/count/message without inserting if any conflict exists. |
| `ensure_patient_identity(text DEFAULT NULL)` | Authenticated own-account provisioning; fixed patient role, Auth/profile locks, existing exact user link or one new own patient row. |
| `admin_link_patient(uuid,uuid)` | Admin-only intentional exact UUID linking; rejects another existing account/patient link and records `patient_link` in `audit_log`. |
| Patient UPDATE privileges | Revoke table-wide and existing column-wide UPDATE; grant only `full_name`, `date_of_birth`, `contact_number`, `address`. Generic browser UPDATE cannot modify `id` or `user_id`, including from staff. |
| Function EXECUTE ACLs | Private generator, validator and trigger have no browser EXECUTE. Public slot/calendar/block/identity/link RPCs grant authenticated EXECUTE and enforce their individual identity/role rules. |

### Phase 1 preserved

- `uq_doctor_slot` is neither dropped nor weakened: unique `(doctor_id, scheduled_time)` where `status NOT IN ('cancelled','no_show')`. The local migration test checks its OID is unchanged, as well as row snapshots.
- Existing appointment table privileges/RLS and profile role column restrictions remain in effect. Patients and browser admins still cannot directly INSERT/UPDATE/DELETE appointments; normal users still cannot assign `profiles.role`.
- Existing `book_appointment`, `staff_book_appointment`, `reschedule_appointment`, `staff_reschedule_appointment`, `cancel_appointment`, `staff_cancel_appointment`, `staff_check_in_appointment`, and `staff_set_appointment_status` retain Phase 1 authorization and transitions. Booking/rescheduling benefit from the replaced private validator.
- Admin role assignment remains through the authorized Phase 1 operation. No service-role key was added to frontend code.
- Patient CRUD RLS remains in place; this phase narrows identity-link UPDATE privileges rather than replacing own-row/staff policies.

## Availability architecture

Patient and staff pages now follow the same path:

`BookAppointment / Booking -> useAvailability -> get_available_appointment_slots -> _clinic_schedule_slots -> filter active appointments`.

The mutation path remains:

`protected Phase 1 booking/reschedule RPC -> _assert_slot_bookable -> _clinic_schedule_slots -> INSERT/UPDATE -> uq_doctor_slot`.

There is no separate React scheduling algorithm. React formats safe returned instants and sends the selected instant back to the protected operation. Patient calendar day buttons call `get_available_appointment_dates`, which derives its flags from the same available-slot RPC. Informational weekday schedule text is not used to authorize or generate slots.

The private candidate generator combines an active doctor, requested date's Manila weekday, each schedule start/end/duration, whole-minute grid, unavailable dates, and an instant strictly after database `now()`. A slot is generated only if its full configured duration fits inside its schedule window. Duplicate candidate timestamps are deduplicated defensively; the installed exclusion constraint rejects the underlying duplicate/overlapping schedule rows.

Occupancy filtering uses all appointments, independent of the patient's SELECT RLS visibility, inside the hardened definer RPC. Only cancelled/no-show appointments release slots. `pending`, `scheduled`, `checked_in`, `waiting`, `in_progress`, and `completed` continue occupying their exact timestamp. Completed visits are not presented as a free slot. An availability result is a snapshot, not a reservation; the unique index remains the final authority for competing submissions.

Responses do not contain another patient's UUID, name, reason, appointment UUID, status, source, or appointment row. The patient appointment SELECT policy was not broadened. The local test verifies another patient's row remains unreadable while its occupied time is excluded from the safe response. Slot occupancy itself is deliberately observable; no patient identity is disclosed.

Today's slot hook refreshes its request key once per minute (timer checks every 15 seconds) so displayed past slots expire. Successful local mutations invalidate it immediately. Backend validation still rejects a slot that has passed or been taken since display.

## Appointment normalization and double-booking

Both approved booking and rescheduling portals reject seconds/fractions and require exact equality with a generated clinic-grid timestamp. A valid schedule slot at `09:00:00` does not allow `09:00:01` or `09:00:00.500`. The table CHECK also protects the whole-minute invariant on trusted backend writes; trusted import/maintenance code remains responsible for using authorized grid-aware operations when appropriate.

Existing finite whole-minute appointment rows are preserved even if a later schedule change places an old visit outside the current grid. Migration does not retroactively reschedule historical appointments. Existing non-minute or infinite timestamps cause the entire transaction to abort with a count-only diagnostic; nothing is rounded, deleted, or rewritten.

The exact-slot uniqueness predicate remains identical. Phase 1 regression tests demonstrate one winner for patient/patient, patient/staff, staff/staff booking, and competing rescheduling. Failed rescheduling keeps the original appointment. Cancelled/no-show slot reuse is retained. This remains **exact start-time** protection; it is not a new duration-based exclusion of visits with different starting timestamps across changed schedules.

## Doctor schedule constraints and migration safety

Weekdays remain the existing integer representation: Sunday `0` through Saturday `6`, with the existing schema weekday constraint retained. Schedule times remain PostgreSQL `time`; duration remains integer minutes. No destructive schema conversion was introduced.

The new CHECK rejects zero/negative/oversized duration, invalid start/end ordering, sub-minute schedule values, and a duration longer than its window. The GiST constraint rejects all intersecting same-doctor/same-weekday ranges, including exact duplicates. Touching windows such as 08:00–17:00 and 17:00–18:00 are permitted. Frontend `scheduleInputError` checks these basic inputs before submission; PostgreSQL remains authoritative. `scheduleBackendError` translates exclusion/uniqueness/check errors into usable staff feedback.

The migration locks the relevant calendar/patient/appointment tables, preflights schedule validity/overlap and appointment minute precision, and only then installs constraints/functions/triggers/grants. Invalid schedule diagnostics identify schedule UUIDs/pairs, without names or patient information. Invalid appointment diagnostics emit only a count. Both invalid-schedule and invalid-appointment fixtures prove rollback, unchanged records, and no partially installed Phase 2 constraints.

No existing conflicting rows are automatically removed. Local repeat execution succeeds without rewriting rows. Canonical Phase 2 SQL is identical in upgrade, fresh schema, one-click schema, and legacy upgrade files. Installing the migration takes locks and therefore must be assessed in staging and scheduled deliberately for any later real rollout.

## Unavailable-date conflict workflow

The chosen workflow is **prevent blocking until conflicts are explicitly resolved**, not an override or bulk cancellation.

`Doctors.addUnavail` calls `staff_block_doctor_date`. The backend checks admin role, finite today/future Manila date, doctor existence, and counts appointments in the exact half-open clinic day, excluding only cancelled/no-show rows. If the count is positive, it returns `success:false`, `conflict_count`, and an explanation; staff see the count and must intentionally reschedule/cancel each eligible visit through the existing operations before retrying. No unavailable-date row is inserted and no appointment is changed.

Even completed visits count for this rule. They cannot be casually cancelled just to unblock administration; a date containing preserved completed history cannot be newly blocked through this workflow while that conflict exists. There is no force-delete or force-cancel control.

The trigger enforces the same restriction for direct staff INSERT or doctor/date-changing UPDATE, so a alternate browser request cannot bypass the page workflow. Reason-only updates to an existing blocked row do not retrospectively destroy history or force cleanup. Removing a block preserves appointments.

Bookings take a SHARE lock on the doctor; calendar changes take UPDATE locks on the same doctor. The concurrent local test proves a new booking and a conflicting new block cannot both become effective: either the visit commits and blocking returns its conflict count, or the block commits and booking is rejected. Existing old blocked dates with pre-existing visits are not silently repaired; read-only aggregate diagnostics are included for authorized review.

## Authentication initialization and patient linkage

### Auth state

Both providers use `usePortalAuth` and `IdentityCoordinator`, while retaining separate Supabase instances/storage keys:

| Portal | Storage key | Resolved identity |
|---|---|---|
| `/patient/*` | `medical-patient` | Exact current Auth UUID, database profile role `patient`, linked patient with matching `user_id`. |
| `/appointments/*` | `medical-appointments-staff` | Exact current Auth UUID and database profile role `admin`; no patient identity loaded. |

The session listener stays synchronous; identity network work is deferred outside the Supabase auth callback lock. Initial `getSession()` results cannot override a newer listener event. Each identity resolution has a request generation and abort signal. A session change immediately publishes cleared profile/patient state, and only the latest identity may commit user/profile/patient together. An older success or failure cannot replace a newer user's data.

Patient resolution calls `ensure_patient_identity`; it validates returned profile ID/role and patient ID/user linkage before accepting success. Staff resolution fetches and checks its exact database profile. Missing profiles, failed provisioning, network errors, malformed identities and wrong roles finish loading with an explicit error. Layouts fail closed and expose retry/sign-out rather than rendering a protected outlet or remaining perpetually loading. Listener/query cleanup cancels generations and unsubscribes on unmount.

Sign-in waits for the real identity result. Immediate-session signup also waits for real backend provisioning; a failed link is returned as an error, not successful signup completion. Confirmation-required signup reports that confirmation/sign-in are still required and does not fabricate profile/patient state. Sign-out clears local identity immediately and uses Supabase `scope:'local'`; the two portal storage keys remain separate. Actual hosted confirmation/persistence/token-refresh behavior still requires staging validation.

### Chosen identity/linking rule

Automatic linking is solely **`patients.user_id = auth.uid()`**. Matching full names, email prefixes, or metadata never authorizes attachment to a clinic record. The old name-based `resolvePatient` workflow is removed.

`ensure_patient_identity` locks the real Auth account row and profile, retains an existing legitimate own link, creates a missing profile with fixed `patient` role, and creates at most one own patient row if no exact user link exists. `uq_patients_user` plus locks control concurrent first-session creation. Profile/patient provisioning is one transaction: failure rolls back and is surfaced. A same-name unlinked clinic patient stays unlinked.

To intentionally attach a clinic-created patient, an authorized administrator verifies identity outside the app and invokes `admin_link_patient` with the exact verified Auth UUID and clinic patient UUID. The function verifies the Auth account exists, requires patient role, permits creation of a patient-only profile before first portal provisioning, rejects conflicting existing links, performs the link and writes an audit entry. A failed call does not claim success and cannot leave a partially created profile/link.

Generic frontend patient UPDATE cannot alter `user_id` or `id`. Patient demographic editing remains permitted under existing RLS. A patient still may create its own patient row under the retained own-row INSERT policy, but cannot attach an existing clinic record via a name-based UPDATE or change another identity.

**PARTIAL workflow limitation:** this phase adds the protected intentional-link operation, not a new identity-verification/OTP or staff linking screen. The human verification must be real and must occur before invoking it. If the account has already provisioned a different patient row, linking rejects the request; the function does not merge/delete histories. Prefer intentional linking before the account's first portal visit. Possible real-world duplicate identities under different Auth accounts remain a manual identity-management concern, not something safely inferred from names.

## Asia/Manila timezone architecture

PostgreSQL appointment storage remains `timestamptz`: absolute instants. Browser date/time formatting and calendar arithmetic now explicitly use `Asia/Manila`.

| Utility in `src/lib/clinicTime.ts` | Purpose |
|---|---|
| `clinicDateKey` | Derive a date key from an absolute instant in Manila; preserve and validate an already date-only key. |
| `validateDateKey` | Reject malformed/impossible YYYY-MM-DD values via explicit UTC calendar round-trip. |
| `clinicInstant` | Convert a clinic date and validated HH:MM into an absolute ISO instant with explicit `+08:00`; seconds are zero. |
| `addClinicDays`, `clinicWeekday` | Date-only arithmetic using UTC calendar methods, not the browser's local midnight/weekday. |
| `clinicWeekDates` | Exact Sunday–Saturday keys for the clinic week containing a date. |
| `clinicDayRange` | Clinic midnight and next midnight; query code uses `>= start`, `< nextStart` rather than local/UTC date slicing. Compatibility `endIso` is also returned. |
| `clinicMonthRange` | Clinic month boundaries and calendar geometry independent of browser timezone. |
| `formatClinicDate`, `formatClinicTime`, `clinicTimeKey`, `formatClinicDateTime` | Explicit Manila Intl formatting; date-only display anchored within its actual clinic date. |

Booking submits the authoritative backend-returned slot ISO, not a browser-local datetime conversion. Reschedule summaries, upcoming/history lists, patient/staff dashboards, check-in timestamps, day/month filtering and directly affected report presets/grouping/display use the shared utilities. The report module's existing calculations and export behavior were not expanded. Birth dates remain date-only patient data; their meaning is not converted into an appointment instant.

In SQL, candidate construction, unavailable-date ranges, current clinic date and weekday use explicit Manila rules rather than session timezone. JavaScript tests spawn processes with `TZ=Asia/Manila`, `UTC`, and `America/New_York`, including an instant crossing the UTC/Manila date boundary. Dates, displayed times, day/month bounds and week dates are identical. PostgreSQL tests also change session timezones and compare available slot epochs.

## Query staleness, refresh and weekly display

`useClinicQuery` identifies each request by the actual doctor/date/patient/filter/revision key. `RequestGeneration` aborts superseded requests and refuses old commits even if transport ignores abort. Returned data is tagged with its key; when a key changes, old data is hidden immediately, including before the next effect runs. Explicit errors replace obsolete rows; unmount cancels the active generation.

This pattern covers slot reads, patient reschedule target/appointment/history/dashboard reads, staff patient search/past visits/upcoming appointments, dashboard day/month filters, check-in days, doctor details and directly affected report/patient filters. Follow-up selection clears on patient change; selected slot clears on doctor/date/mutation revision change.

`appointmentMutationSucceeded` only broadcasts when there is no error and the RPC reports success. Every subscribed view increments its query key through `useAppointmentRevision`. Staff book/move/cancel and check-in/status actions, patient book/move/cancel, and successful calendar changes invalidate affected views. Failed operations do not falsely refresh as success. Cleanup removes subscribers. Tests exercise both the generic subscribers and the actual staff Booking rendered list after each operation.

This is local-client invalidation, not Realtime or cross-device synchronization. Another browser's mutation becomes visible when availability is fetched again; uniqueness/backend validation protects submission regardless of an older snapshot. Realtime was not added.

`Doctors` derives seven actual date keys with `clinicWeekDates`; a day displays Leave only if an unavailable row matches that exact week's date. Checking weekday alone was removed. The visible week range and block banner use the same dates. A blocked Monday next month cannot mark this week's Monday as Leave.

## Tests and build results

### Commands actually run

| Command | Result |
|---|---|
| `npm install --save-dev --save-exact react-test-renderer@18.3.1 --ignore-scripts --no-audit --no-fund` | PASS; added only the matching development renderer and its dependencies. Existing locked dependency versions were checked unchanged. No secrets required. |
| `npm run build` | PASS: `tsc --noEmit` and Vite production build; 110 modules transformed. |
| `node scripts/verify.mjs` | PASS: all 52 static checks. Static checks establish source structure, not live backend behavior. |
| `node scripts/test-phase1.mjs` | PASS: all 25 Phase 1 checks with current fresh/legacy SQL, including concurrent booking/rescheduling, roles, table ACLs, preserved records and safe function execution. |
| `node scripts/test-phase2-ui.mjs` | PASS: 9 mounted hook/component/timezone checks; also executed by the combined Phase 2 suite. |
| `node scripts/test-phase2.mjs` | PASS: canonical SQL-copy assertion, 9 imported mounted UI/timezone checks, and 14 synthetic local database checks. |
| `git -c core.autocrlf=false diff --check` | PASS: no whitespace errors in tracked changes. |

Final build assets: `dist/assets/index-DuW3u7Iu.js` **511.12 kB**, gzip **141.13 kB**. Vite reports the existing-category non-blocking warning: `Some chunks are larger than 500 kB after minification.` No code splitting/performance work was undertaken in this phase.

During implementation, an initial TypeScript build reported TS2339 because `.abortSignal()` followed `.maybeSingle()` in staff identity loading; ordering was corrected to call abortSignal before maybeSingle. The final build has no TypeScript errors. An initial mounted test fixture tried to emit an auth event before the React effect installed its listener; the fixture was corrected to flush effects first. These initial failures are resolved, not outstanding failures.

### Requested A–L coverage

| Test | Evidence | Result |
|---|---|---|
| A. Other patient's occupancy without private data | Call safe slot RPC as Patient A while Patient B owns the occupied visit; assert timestamp excluded, response keys only timestamp/duration, and B's appointment remains invisible under A's SELECT. | CONFIRMED locally |
| B. Patient/staff equivalent slots | Compare both patient accounts and admin arrays on partial/empty/full/cancelled/no-show/completed/blocked/today states. | CONFIRMED locally |
| C. 09:00:01 invalid | Patient and staff RPC reject seconds/fractions; valid whole-minute succeeds; trusted non-minute insert fails CHECK. Phase 1 also retains exact grid rejection. | CONFIRMED locally |
| D. Duplicate/overlapping schedule rejection | Direct admin inserts fail CHECK/exclusion; adjacent ranges succeed; legacy overlap migration aborts unchanged. | CONFIRMED locally |
| E. Zero/negative duration rejection | Direct SQL rejects zero, negative, fractional/integer-invalid and over-window duration; UI validation tests mirror usable input messages. | CONFIRMED locally |
| F. Cancelled/no-show release | Both statuses' timestamps are offered again; completed timestamp remains excluded. | CONFIRMED locally |
| G. Detect appointments before blocking | Admin RPC returns count 1 and no block; direct staff insert fails trigger; concurrent blocking/booking cannot both apply. | CONFIRMED locally |
| H. No previous user's patient | Mount actual auth hook, switch identities while old promises settle, assert immediate clearing/latest user only and listener cleanup. | CONFIRMED locally |
| I. Failed linkage cannot succeed | Actual hook receives failed/mismatched identity RPC packets; sign-in/sign-up return errors, loading resolves, patient remains null. SQL rejects conflicting intentional links. | CONFIRMED locally |
| J. Same clinic time under runtime timezones | Spawn Manila/UTC/New York Node runtimes and compare shared utility outputs; compare PostgreSQL slot epochs across session timezones. | CONFIRMED locally |
| K. Rapid doctor/date queries | Mount actual availability hook; resolve obsolete requests late despite ignored abort; newest state wins, unmount aborts. | CONFIRMED locally |
| L. Staff refresh after booking/move/cancel | Mount actual staff Booking with synthetic backend double; trigger its real handlers and inspect updated upcoming rendered rows without remount. Shared subscribers also tested. | CONFIRMED locally |

Additional local checks cover inactive doctor, unavailable day, today past-slot exclusion, exact-week Leave behavior, signup concurrency, existing exact links and unlinked namesakes, admin pre-link before missing-profile provisioning, private/anonymous RPC denial, SECURITY DEFINER search_path, repeat migration, table row snapshots, index OID preservation, bad existing schedule rollback, and bad existing appointment timestamp rollback.

React tests substitute synthetic clients inside the test process and never invoke hosted Supabase. Database tests bootstrap the original repository schema plus Phase 1 and Phase 2 into isolated local databases. They do not accept production connection URLs or fall back to a remote service. PostgreSQL binaries are required on PATH (or local `PG_BIN`); missing binaries fail rather than running remotely. The suite requires Git's original schema baseline to be available.

## Remaining problems and NOT VERIFIED items

| Item | Status / remaining limit |
|---|---|
| Existing hosted schema, ACL drift and migration ordering | NOT VERIFIED. No hosted catalog or deployment was touched. Apply Phase 1 first; inspect staging before rollout. |
| Supabase extension/ownership compatibility | NOT VERIFIED on hosted Supabase. `btree_gist`, function-owner access and locking `auth.users` must be validated with the intended migration owner in staging. Local PostgreSQL 18 passes. |
| Hosted Auth / PostgREST integration | NOT VERIFIED. JWT profile identity, real listener order, email confirmation, persistence, refresh, RPC schema cache and browser logout behavior need staging end-to-end testing. |
| Identity verification for clinic-record linking | PARTIAL administrative workflow: safe exact UUID RPC exists; actual human identity verification and a dedicated linking UI are not implemented. No name-based shortcut. |
| Existing account already owns a different patient row | Explicitly rejected by admin linking; no automatic merge/deletion. Separate authorized reconciliation design is required if real historical duplicates exist. |
| Existing bad schedules/non-minute appointments | Migration safely aborts. Actual hosted presence/count is NOT VERIFIED. Review privately; no automatic record cleanup is included. |
| Existing blocked-date/appointment conflicts | Preserved, not retroactively cancelled or repaired. Aggregate read-only diagnostics included; actual hosted cases are NOT VERIFIED. |
| Changing schedules with existing visits | Existing visits stay intact even if no longer on the current schedule. A visit whose existing exact start is not a new grid point can overlap the duration of a different new start; only exact-start uniqueness is guaranteed here. |
| Live multi-browser/multi-device refresh | No Realtime added. Same-client mutations invalidate mounted reads; other clients rely on refetch/today polling and final backend validation. |
| Minute timer / long-open views | Today's slot options refresh by minute; database remains authoritative. Dashboard day/week rollovers in a continuously open tab were not given a separate clock subscription. |
| Staff rapid repeated submission UX | Backend uniqueness and valid transitions remain safe; a comprehensive busy-state redesign was not added to every staff control. |
| Patient profile name mirroring | Existing best-effort synchronization between demographic row and profile remains outside this phase; it does not authorize identity linking. |
| Demo/secret/bootstrap risks in original audit | Original deployment-hardening findings still require separate review. No credential file content was inspected and no demo credential remediation was performed here. |
| Notifications, scheduler, Realtime, reports/export features, doctor editing, redesign and performance | Deferred by scope. This phase does not claim those original audit findings are fixed. Report date helpers only were affected. |
| Browser visual/E2E validation | NOT VERIFIED in a real browser against hosted services. Mounted component tests cover the specified behavioral paths with controlled data. |

## Manual staging and deployment instructions

These are instructions for a later authorized operator; **none were executed against Supabase**.

1. Create/use an isolated staging Supabase project with synthetic or properly protected data. Review backups, function ownership, extension support and actual existing RLS/column ACLs. Confirm Phase 1 has been installed and its regression/security expectations match the current hosted catalog.
2. Review `supabase/fix_phase2_booking_availability.sql` in full. For an existing database, use this incremental file after Phase 1; do not run `full.sql` or a fresh-install schema as an upgrade, and do not reset the database.
3. Assess the migration locks and stage it with the intended owner. If preflight rejects schedule IDs/pairs or appointment timestamp counts, stop and privately review those rows. Do not delete, silently round, or automatically reschedule real history to make the migration pass. This file intentionally rolls back rather than performing that cleanup.
4. Install the migration only in staging first. Preserve its transaction boundaries. Check constraints, trigger definitions, function search_path/EXECUTE ACLs, patient column privileges and unchanged `uq_doctor_slot`; the added `supabase/rls_tests.sql` queries are read-only diagnostics, not destructive tests.
5. Verify PostgREST recognizes the new public RPC signatures after the normal schema-cache refresh procedure. Coordinate frontend rollout with migration availability: the new frontend fails explicitly if its RPC is absent, rather than falling back to a privacy-unsafe appointment query or fabricated identity.
6. Test fresh patient signup with and without email confirmation, existing exact user linkage, missing profile, missing patient, wrong portal role, stale sessions, refresh/login/logout in both independent portals, and network failure/retry. Exercise account switching and different browser timezones using synthetic accounts.
7. For a clinic-created unlinked patient, an authorized admin verifies the actual person and exact Auth account UUID outside the application, then calls `admin_link_patient(p_user_id, p_patient_id)` using that administrator's authenticated context. Prefer before first patient portal provisioning. If a different linked row already exists, stop; this function intentionally rejects rather than merging histories. Never put service-role credentials in a browser.
8. Compare patient/staff slots for empty, occupied, fully booked, inactive, blocked, cancelled/no-show/completed and current-day cases; try off-grid seconds/fractions, invalid schedules, booking collisions and the booking/block race using synthetic staging records. Verify blocked-date conflict counts and explicit individual appointment resolution.
9. Verify mutation refresh and check-in/status changes in the actual browser, reports' existing date filtering in Manila, and exact-week doctor Leave labels. Do not infer notifications/cron/Realtime readiness from these checks.
10. Any later production rollout requires separate authorization, protected backup/recovery planning, and a reviewed staging outcome. This remediation task does not authorize or perform that rollout.

## Final Phase 2 assessment

**CONFIRMED locally:** one privacy-safe availability rule is shared by patient/staff and protected appointment mutations; minute/grid validation and schedule constraints are authoritative; conflicting date blocking is prevented; identity state cannot commit an old user's patient; names cannot attach clinic records; clinic date/time behavior is independent of browser timezone; successful mutations refresh subscribed views; all Phase 1 regressions pass.

**PARTIAL:** intentional clinic-record linkage is a protected admin operation requiring a real out-of-band identity check, without a new staff linking/verification screen or automatic historical merge. Cross-client live refresh remains outside scope.

**NOT VERIFIED:** current deployed Supabase behavior, real records, hosted Auth/RPC integration and real-browser end-to-end behavior. The migration has not been applied to production or any hosted project.

Phase 2 is complete as a local implementation and verification pass. Do not call the hosted project fixed until the incremental migration and frontend are deliberately staged and validated. Notifications, broader report/export work, Realtime, UI redesign, performance and Phase 3 were not started.
