# MedicAppointment — Final Verification and Release Readiness Report

Updated 2026-10-03T11:07:07.595Z (UTC); clinic timezone Asia/Manila. Workspace: D:\Development\Projects\draft.

Read first: MEDICAPPOINTMENT_AUDIT_REPORT.md, all three Phase 1–3 fix reports, MEDICAPPOINTMENT_PHASE4_REPORT_FIX.md, the existing final report and PHASE4_CONTINUATION.md. Resumed verification from the incomplete integration checks. Completed report-fix implementation was preserved; this continuation changes verification scripts/evidence/documentation only.

**Dashboard/Reports defect: FIXED LOCALLY. HOSTED DEPLOYMENT NOT VERIFIED.** No staging migration evidence exists. Hosted Supabase was not queried or modified, no deployment/seed/reset/provider send occurred, and no new development phase began.

Evidence boundaries: CONFIRMED/FIXED refer to the stated local SQL, browser, mounted or mocked boundary. PARTIAL has explicit remaining coverage; NOT VERIFIED denotes an unexercised environment. Browser Auth is synthetic; the verification REST translator executes real disposable PostgreSQL SQL, but is not GoTrue/PostgREST or gateway JWT verification. Synthetic account credentials and private environment values are omitted.

Freeze: 82 post-fix source/configuration/SQL/package hashes and 5 historical report hashes match scripts/phase4-postfix-release-baseline.json. The old 78-file baseline and previous regression/browser/Excel evidence are retained as historical evidence, not claimed unchanged across the completed report fix. Existing unrelated workspace edits were preserved.

## A. Executive Summary

Build, static verification, Phase 1–3, targeted read-only report security tests, Edge checks, fresh installation, the complete incremental chain, concurrency, SQL report totals and SQL-backed Chrome/Edge browser checks pass. Database-enforced role restrictions, appointment ACLs, mutation locking and exact-slot protection remain intact.

The release-blocking SELECT FOR SHARE defect was confirmed and fixed in the preceding narrow fix. The read-only RPCs called locking _require_admin(); they now use _require_admin_readonly(), preserving STABLE and locking mutation authorization. Both pages load locally, handle empty results and recover with Retry. Hosting the old function definitions remains an unverified deployment risk.

| Target | Classification | Basis |
|---|---|---|
| Complete connected school demonstration | **NOT READY** | Local synthetic demonstrations pass; real Auth/PostgREST rehearsal is missing |
| Isolated staging trial | **READY WITH PREREQUISITES** | Local migrations/security pass; isolated target, migration review/configuration and live tests required |
| Production | **NOT READY** | Hosted integrations, operational/privacy review, dependency disposition and recovery evidence missing |

Current npm audit exits 1: 9 vulnerable package classifications (6 high, 3 moderate, zero critical). This supersedes the old four-package snapshot. Dependency versions were preserved.

## B. Release Candidate Architecture

React 18.3, React Router 6 declarative BrowserRouter/Routes, TypeScript and Vite form the SPA. Installed lockfile versions include Vite 5.4.21, esbuild 0.21.5, react-router/react-router-dom 6.30.6 and @supabase/supabase-js 2.116.0. package-lock.json version 3 agrees with package.json root dependencies and devDependencies.

src/App.tsx mounts independent patient and staff providers. src/lib/supabaseClient.ts creates clients with persistent/auto-refreshing sessions, URL detection disabled, storage keys medical-patient and medical-appointments-staff. usePortalAuth/portalIdentity/asyncState resolve one identity packet atomically, reject wrong roles, clear stale patient/profile state, apply initialization/query deadlines and unsubscribe. signOut uses local scope.

Ten public application tables, RLS, column ACLs, SECURITY DEFINER functions with explicit safe search_path and EXECUTE ACLs implement the backend. Appointment browser writes are SELECT-only plus approved ownership/admin RPCs. All patient/staff availability and writes share _clinic_schedule_slots/_assert_slot_bookable. PostgreSQL timestamptz stores instants; clinicTime.ts supplies Manila dates/times/ranges/weeks.

Appointment mutation invalidation refreshes local mounted views. The staff auth provider owns one debounced appointment Realtime subscription; patients have no global feed. Optional publication installation is separate.

Phase 3 SQL creates an appointment-versioned SMS outbox/ledger. send-confirmation verifies Auth and SQL ownership; send-reminders uses CRON_SECRET; notification-status verifies a Twilio signature. Worker claims/leases and result persistence distinguish provider acceptance from later delivery. Vault-backed five-minute scheduler installation is separate. Reports use admin-only complete SQL aggregation and paged audit RPCs, with shared spreadsheet-safe CSV encoding.

Required migrations, Edge folders/configuration, scheduler/publication files, environment example and verification scripts exist. .env.example has only fake placeholders for the three public frontend variables and server-only variable names in comments.




Read-only authorization has a separate private, STABLE SECURITY DEFINER helper with empty search_path, qualified profiles/auth.uid(), explicit ACLs and fail-closed admin checks. SELECT-only admin_patient_duplicate_count shares it. Mutation RPCs retain _require_admin(). Canonical schema.sql/full.sql/legacy/full_demo definitions and the Phase 3 block were aligned by the completed fix.

Continuation files: scripts/test-phase4.mjs (adds the report fix to the full migration chain); test-phase4-sql-browser.mjs, phase4-sql-browser-bridge.mjs, phase4-sql-browser-flows.mjs; verify-release.mjs (current final commands/freeze validation); write-phase4-postfix-report.mjs; the obsolete write-final-report.py now refuses to overwrite post-fix evidence; phase4-postfix-release-baseline.json, phase4-postfix-dependency-audit.json, phase4-postfix-environment-hygiene.json, phase4-postfix-final-regression-results.json, phase4-sql-browser-results.json and SQL-browser mobile screenshots. Original audit/Phase 1–3/report-fix reports remain byte-identical. No application, SQL, notification, role, package or scheduling changes were made during continuation.

## C. Phase 1–3 Regression Results

Final post-fix run: scripts/verify-release.mjs; exact outputs in scripts/phase4-postfix-final-regression-results.json. All 11 commands exit zero.

| Command | Exit | Seconds | Result |
|---|---|---|---|
| npm run build | 0 | 11.1 | PASS |
| node scripts/verify.mjs | 0 | 0.17 | PASS |
| node scripts/test-phase1.mjs | 0 | 93.78 | PASS |
| node scripts/test-phase2.mjs | 0 | 90.73 | PASS |
| node scripts/test-phase3.mjs | 0 | 86.64 | PASS |
| node scripts/test-phase4-readonly-reports.mjs | 0 | 93.13 | PASS |
| node scripts/check-edge.mjs | 0 | 2.18 | PASS |
| node scripts/test-phase4.mjs | 0 | 102.11 | PASS |
| node scripts/test-phase4-reports.mjs | 0 | 68.65 | PASS |
| node scripts/test-phase4-sql-browser.mjs | 0 | 167.76 | PASS |
| git diff --check | 0 | 0.4 | PASS |

Counts: static 69; Phase 1 25; Phase 2 9 mounted/timezone + 14 database; Phase 3 19 mounted/handler/UI + 15 database; read-only report regression 14 SQL/security and mounted portal groups; Edge seven files; general Phase 4 13 database/handler/CSV groups; independent report oracle 1,211 visits/185 audit rows under three SQL timezones; SQL-backed browsers 34 groups across Chrome/Edge.

Historical clean npm ci and normal Excel CSV open evidence are retained. npm ci was not repeated on this continuation; package/lock hashes remained unchanged. Current build includes the existing >500 kB bundle warning. No ESLint configuration exists; no lint result is claimed.

Test-harness corrections: logout assertions now wait for the SDK storage key to clear; browser form actions wait for loaded values/native validity instead of page headings alone. Clinical progression fixtures use today's clinic date and future-date denial remains tested. No production code change or weakened assertion was required.

### Exact final regression outputs

#### npm run build

Exit 0; 11.1s.

```text

> medical-appointment@0.2.0 build
> tsc --noEmit && vite build

vite v5.4.21 building for production...
transforming...
✓ 118 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   1.18 kB │ gzip:   0.62 kB
dist/assets/index-CvtWwqyU.css   40.13 kB │ gzip:   7.52 kB
dist/assets/index-L1XmYyCU.js   521.43 kB │ gzip: 144.31 kB
✓ built in 4.33s

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

```

#### node scripts/verify.mjs

Exit 0; 0.17s.

```text
PASS  queue-board frontend removed
PASS  no queue UI/API references in src (outside legacy redirect + comments)
PASS  schema has no queue objects (comments may mention them)
PASS  schema roles are admin + patient only
PASS  no staff policy grants receptionist/doctor/board
PASS  double-booking unique index (doctor_id, scheduled_time) excluding cancelled/no_show
PASS  staff booking surfaces 23505 as taken-slot
PASS  patient RLS policy patient_read_doctors
PASS  patient RLS policy patient_read_schedules
PASS  patient RLS policy patient_read_unavailable
PASS  patient RLS policy patient_select_own
PASS  patient RLS policy patient_insert_own
PASS  patient RLS policy patient_update_own
PASS  patient RLS policy patient_select_own_appointments
PASS  RPC my_patient_id defined + granted
PASS  RPC book_appointment defined + granted
PASS  RPC reschedule_appointment defined + granted
PASS  RPC cancel_appointment defined + granted
PASS  page title "Book an Appointment"
PASS  "Choose a Doctor"
PASS  "Book an Appointment with"
PASS  "Choose a Date"
PASS  "Choose an Available Time"
PASS  "Review Your Appointment"
PASS  "Confirm Appointment"
PASS  "Appointment Booked Successfully!"
PASS  "My Appointments"
PASS  empty state "No Appointments Yet"
PASS  empty state "No Available Times"
PASS  no doctor-centric wording in patient portal
PASS  router: /patient/* + /appointments/* exist, queue-board redirects
PASS  staff + patient use distinct storage keys
PASS  shared LoginShell holds no auth logic (boundary)
PASS  seed.cjs remains a backend-only bootstrap tool
PASS  seed.cjs links patient login to a patient record
PASS  seed.cjs seeds doctors/schedules/patients/appointments/notes
PASS  old seed files removed
PASS  patient booking is RPC-only and fails closed
PASS  staff booking uses authoritative RPC
PASS  staff check-in uses authorized RPC
PASS  profile role changes use authorized RPC
PASS  patient profile INSERT omits role
PASS  both portals consume the shared availability hook
PASS  React does not generate appointment slots
PASS  availability returns timestamps/durations only
PASS  backend rejects schedule overlap and invalid minute durations
PASS  blocking dates uses authorized conflict-aware operation
PASS  legacy name matching removed from authentication
PASS  auth callback is synchronous and subscription cleans up
PASS  portal signout uses local scope
PASS  appointment views subscribe to mutation invalidation
PASS  weekly doctor display checks exact clinic week dates
PASS  durable notification event idempotency is defined
PASS  ledger worker RPCs are service-only
PASS  confirmation verifies Auth and ownership via SQL
PASS  notification CORS uses explicit origins and OPTIONS
PASS  provider result distinguishes acceptance from delivery
PASS  notification providers do not log patient payloads
PASS  both booking portals notify only after approved mutations
PASS  reminders use Manila dates and durable unique events
PASS  reports use complete server aggregation and ID grouping
PASS  CSV uses shared spreadsheet-safe encoder
PASS  doctor editing is validated and non-destructive
PASS  intentional linking UI uses exact UUID/admin operation
PASS  major mutation pages use synchronous pending gate
PASS  staff Realtime unsubscribes through isolated provider
PASS  nonexistent confirmed database status is removed
PASS  safe environment template and local-only demonstration guard exist
PASS  signed delivery callbacks and Vault cron definitions exist

ALL CHECKS PASSED (static only)

```

#### node scripts/test-phase1.mjs

Exit 0; 93.78s.

```text
PASS installation and upgrade files have identical security operations
PASS browser appointment mutation paths are RPC-only
PASS only safe profile fields are sent by patient registration; role management uses RPC
PASS existing verification cannot trigger production writes from environment
PASS G: migration preserves every existing profile, patient, doctor, schedule, appointment, note and audit row
PASS migration is repeatable without rewriting history or existing rows
PASS fresh schema and one-click schema both execute safely in local empty databases
PASS legacy upgrade executes atomically and includes Phase 1 protections
PASS A: patient cannot update role, assign role at signup, or invoke administrative role assignment
PASS B: permitted profile fields remain editable; other patient profiles remain inaccessible
PASS new signup receives database-default patient role and can create its own linked patient row
PASS authorized admin role assignment remains functional; self-demotion/unknown role are rejected
PASS C: patients and browser admins cannot directly INSERT/UPDATE/DELETE appointments
PASS D: approved patient booking derives ownership, actor and fixed scheduled status
PASS E: staff booking applies the same authoritative schedule checks and writes reason/note atomically
PASS F: uq_doctor_slot still blocks sequential exact duplicates, including direct trusted backend inserts
PASS concurrent patient/patient same-slot requests: one winner
PASS concurrent patient/staff same-slot requests: one winner
PASS concurrent staff/staff same-slot requests: one winner
PASS rescheduling validates ownership/status/slot and failure preserves original appointment
PASS concurrent patient/staff rescheduling into one slot: one winner
PASS cancellation retains history, releases the exact slot and never revives terminal rows
PASS check-in and clinical progression require admin, clinic day, valid transitions and timestamp
PASS pending confirmation and no-show progression follow backend rules and retain no-show slot reuse
PASS function execution ACLs and search_path deny anonymous/private entry points and temporary-table shadowing

25 checks passed. All database writes used synthetic data on loopback PostgreSQL only.

```

#### node scripts/test-phase2.mjs

Exit 0; 90.73s.

```text
PASS H: real auth hook clears prior patient immediately and stale identity/initial-session results cannot win
PASS I: failed or mismatched linkage returns an explicit error, clears identity and ends loading
PASS wrong portal role fails closed, and signout uses local scope
PASS K: real availability hook rejects late responses after rapid doctor/date changes and unmount
PASS all subscribed appointment views reload only after successful persisted operations and unsubscribe
PASS J: clinic timestamps, day/month bounds and exact week dates are identical in three runtime timezones
PASS schedule form rejects non-minute, zero, negative and oversized durations
PASS L: actual staff Booking handlers refresh the displayed upcoming list after book/move/cancel
PASS weekly doctor view uses exact displayed dates; a Monday four weeks later is not Leave this week

9 Phase 2 mounted UI/timezone checks passed. No production client used.
PASS Phase 2 canonical SQL matches fresh and legacy sources
PASS Phase 2 migration preserves every existing valid row and exact-slot index identity; repeat application is safe
PASS A/B: patient availability hides another patient occupied slot while returning exactly the staff-safe fields
PASS empty and completely booked days have consistent availability in both portals
PASS C: seconds and fractional seconds cannot bypass approved booking operations
PASS D/E: database rejects duplicate, overlapping, zero/negative/fractional duration and non-minute schedules
PASS invalid pre-existing schedules abort migration without deletion, cleanup or partial changes
PASS pre-existing non-minute appointment aborts migration without rounding or rewriting history
PASS F: cancelled/no-show release slots; completed appointments still occupy their exact slot
PASS G: conflict count prevents date blocking; direct staff INSERT cannot bypass the trigger
PASS blocking vs booking race cannot leave both a new block and an active visit
PASS today excludes past slots, inactive doctor has no slots and date calendar uses identical backend rules
PASS patient identity provisioning preserves own links and never matches an unlinked namesake
PASS concurrent first patient identity resolution creates one record and returns the real committed link
PASS RPC privacy/role ACLs remain protected and schedule/slot instants are timezone independent in PostgreSQL

14 Phase 2 local database checks passed; mounted UI/timezone checks and canonical-copy verification also passed.

```

#### node scripts/test-phase3.mjs

Exit 0; 86.64s.

```text
PASS A: OPTIONS and all allowed-origin success/error responses carry consistent restrictive CORS
PASS B: malformed JSON, null, missing ID, invalid UUID and invalid type are rejected
PASS C: unauthenticated/invalid token/other patient rejected; own patient and admin accepted
PASS D: provider rejection/5xx/transport failure cannot produce acceptance or leak provider body/secrets
PASS E/F: repeated confirmation/reminder handler execution sends the accepted event once
PASS G: reminder display is Manila-specific under three runtime timezones and contains no patient/medical fields
PASS L: CSV neutralizes formulas in patient/doctor/contact/text values while preserving Unicode and quotes
PASS M: doctor and patient forms reject nonblank/length/contact/impossible or future DOB errors
PASS N/P: actual intentional-link UI requires verification/exact UUID, rejects conflicts and sends one request
PASS O: real query UI distinguishes loading, failure, retrying, and loaded empty
PASS P: mutation gate blocks same-tick duplicate submits and recovers after thrown failure
PASS Q: staff-only Realtime has one subscription, debounced invalidation and cleanup on identity/role/unmount
PASS Frontend notification wording reflects accepted/stubbed/failed structured results
PASS Signed delivery callback rejects forged/tampered requests and accepts independently computed HMAC
PASS Query/identity deadlines end hanging loads and cannot commit a later stale result
PASS Exact-count pagination handles lower server row caps and fails on truncated/error results
PASS Demonstration seeder refuses a hosted URL before creating a client or touching data
PASS Patient registration/login and staff login block repeated submissions in mounted forms
PASS Initial Auth session read has a deadline and ignores a late initial result

19 Phase 3 handler/UI/timezone checks passed. All provider calls mocked.
PASS Phase 3 canonical installation/upgrade copies match
PASS Migration preserves existing rows/index and is repeatable
PASS E: committed bookings enqueue once; failed transactions enqueue nothing; own/admin authorization only
PASS Concurrent claims send once; accepted rows cannot be claimed again
PASS F/G: Manila tomorrow window, morning gate and durable reminder deduplication
PASS Delivery callbacks record delivery once and cannot downgrade terminal state
PASS H/I: reschedule supersedes old notice and uses new instant; cancellation prevents reminder
PASS Known retry is bounded; ambiguous/expired attempts are held without duplicate sends
PASS J/K: reports group by immutable IDs and Manila date; totals exceed browser row caps
PASS M: doctor backend edit validation and non-destructive deactivation
PASS Clinic date boundary and audit pagination are complete rather than runtime-local/capped
PASS Admin duplicate review is complete and private; visit notes cannot attach to another patient
PASS Patient/profile validation is backend authoritative and own profile mirroring is atomic
PASS Incompatible pre-existing demographics abort incremental installation without rewriting records
PASS Notification ledger privacy and service-only worker ACLs
PASS Deployable scheduler uses Vault and a single named cron job; no credentials embedded

15 Phase 3 local database checks passed. Scheduler transport was mocked; nothing contacted a hosted service.

```

#### node scripts/test-phase4-readonly-reports.mjs

Exit 0; 93.13s.

```text
PASS reproduced the exact read-only error in both legacy reports and duplicate counting
PASS patch is repeatable, preserves all records and retains mutation role locks
PASS read-only Dashboard calendar, report totals, filters and audit pagination in three timezones
PASS admin-only authorization, demoted/missing users, anonymous denial and validation in read-only transactions
PASS all 12 STABLE/IMMUTABLE public functions and their call graphs are free of row locks/writes; private helper ACL/search_path checked
PASS patient role escalation, profile shadowing and direct appointment writes denied; exact-slot duplicate still rejected
PASS reports take no actor row lock; protected cancellation still holds the Phase 1 role lock until transaction end
PASS canonical Phase 3 upgrade retains the read-only fix and leaves records intact
PASS Dashboard component loads actual SQL day/calendar data and normal empty state without the lock error
PASS Dashboard exposes an actual SQL failure and Retry reloads data
PASS Reports component loads actual SQL totals/audit and normal empty states
PASS Reports totals and audit each expose actual SQL failures and recover through Retry
PASS patient calling the Reports component still receives database authorization denial
PASS patient is redirected away from both staff routes before report RPCs execute
14 Phase 4 read-only report regression groups passed (8 SQL/security and 6 mounted portal checks). Hosted Supabase NOT VERIFIED.
⚠️ React Router Future Flag Warning: React Router will begin wrapping state updates in `React.startTransition` in v7. You can use the `v7_startTransition` future flag to opt-in early. For more information, see https://reactrouter.com/v6/upgrading/future#v7_starttransition.
⚠️ React Router Future Flag Warning: Relative route resolution within Splat routes is changing in v7. You can use the `v7_relativeSplatPath` future flag to opt-in early. For more information, see https://reactrouter.com/v6/upgrading/future#v7_relativesplatpath.

```

#### node scripts/check-edge.mjs

Exit 0; 2.18s.

```text
PASS offline Edge TypeScript: 7 files; no network or filesystem output.

```

#### node scripts/test-phase4.mjs

Exit 0; 102.11s.

```text
PASS Complete fresh schema executes; ten tables, RLS, index, triggers and required public RPCs exist
PASS Synthetic complete pre-upgrade database survives Phase 1 → 2 → 3 → read-only report fix with UUID/history/roles/notes/audit/index OID unchanged
PASS Incrementally upgraded database authorizes both STABLE reports in read-only transactions while denying patient/anonymous/private-helper access
PASS Incompatible zero-duration, overlapping and invalid demographic fixtures fail safely without deleting/rewriting rows
PASS Anonymous cannot read patient/private appointment tables, mutate appointments or execute private/admin/booking RPCs
PASS Patient own reads and operations work; patient B data/mutations, clinical writes, staff booking, reports and ledger are denied
PASS Role escalation fails for UPDATE, INSERT, UPSERT, admin RPC, malformed UUID, extra RPC arguments and forged metadata
PASS Five concurrency combinations yield exactly one winner under the shared exact-slot rule
PASS 09:00:00 valid; seconds/fractions/off-grid rejected; cancelled and no-show slots released
PASS Patient/staff availability is identical and private; inactive/blocked/full/completed/past rules apply
PASS Admin clinical progression works; terminal revival, future check-in and skipped transitions are rejected
PASS Real notification handlers use actual local ledger; duplicate send, 400/429/500/timeout and persistence behavior are correct
PASS CSV neutralizes formulas/leading whitespace while preserving Unicode/quotes/commas/newlines

13 Phase 4 release checks passed. No hosted database/provider contacted.

```

#### node scripts/test-phase4-reports.mjs

Exit 0; 68.65s.

```text
PASS Phase 4 report oracle: 1211 total / 4 no-shows / 1201 cancelled / 3 walk-ins; eight statuses, ID isolation, clinic midnight, doctor/empty filters and audit 100+85 under three SQL timezones.

```

#### node scripts/test-phase4-sql-browser.mjs

Exit 0; 167.76s.

```text
PASS Chrome: root/anonymous protected routes redirect to correct portal login
PASS Chrome: wrong password visible; patient signup, provisioning and dashboard render
PASS Chrome: patient direct refresh routes render with restored real SDK session
PASS Chrome: patient doctor/date/slot/book → list → reschedule → cancel → history
PASS Chrome: patient query error/retry and failed identity are explicit rather than indefinite/empty
PASS Chrome: patient session alone cannot access staff; independent admin login restores staff routes
PASS Chrome: patient demographic save persists through SQL and refresh
PASS Chrome: staff creates, searches and edits a clinic patient with SQL persistence
PASS Chrome: staff doctor create/edit/activate and working-hour/block CRUD persists through SQL
PASS Chrome: staff books, moves and cancels through protected SQL RPCs
PASS Chrome: staff check-in, waiting, room, completion and visit note persist with audit
PASS Chrome: staff Dashboard/Reports real SQL totals, audit, CSV and Retry recover
PASS Chrome: separate SDK storage keys coexist; admin logout preserves patient session
PASS Chrome: wrong-role restored sessions fail closed in both portals; patient logout and login again work
PASS Chrome: clinic appointment display identical under Manila/UTC/New York browser timezones
PASS Chrome: mobile viewport login/patient/booking and invalid nested route behavior
PASS Edge: root/anonymous protected routes redirect to correct portal login
PASS Edge: wrong password visible; patient signup, provisioning and dashboard render
PASS Edge: patient direct refresh routes render with restored real SDK session
PASS Edge: patient doctor/date/slot/book → list → reschedule → cancel → history
PASS Edge: patient query error/retry and failed identity are explicit rather than indefinite/empty
PASS Edge: patient session alone cannot access staff; independent admin login restores staff routes
PASS Edge: patient demographic save persists through SQL and refresh
PASS Edge: staff creates, searches and edits a clinic patient with SQL persistence
PASS Edge: staff doctor create/edit/activate and working-hour/block CRUD persists through SQL
PASS Edge: staff books, moves and cancels through protected SQL RPCs
PASS Edge: staff check-in, waiting, room, completion and visit note persist with audit
PASS Edge: staff Dashboard/Reports real SQL totals, audit, CSV and Retry recover
PASS Edge: separate SDK storage keys coexist; admin logout preserves patient session
PASS Edge: wrong-role restored sessions fail closed in both portals; patient logout and login again work
PASS Edge: clinic appointment display identical under Manila/UTC/New York browser timezones
PASS Edge: mobile viewport login/patient/booking and invalid nested route behavior
34 browser checks passed; no hosted request allowed.

```

#### git diff --check

Exit 0; 0.4s.

```text
Whitespace check passed; source context intentionally omitted.
```

## D. Fresh Install Verification

**CONFIRMED locally:** current complete non-demo supabase/schema.sql executes in a disposable loopback PostgreSQL 18 database with synthetic auth.users/auth.uid() and anon/authenticated/service_role fixtures. Ten application tables have RLS; required RPCs, protected uq_doctor_slot, constraints and triggers exist. The Phase 4 helper/report definitions are included in fresh SQL and verified by the report regression. Phase 1–3 also verify canonical fresh/legacy equality. The targeted suite tests whole schema.sql and full.sql builds plus repeated incremental fix application.

Detailed catalog inventory: scripts/phase4-database-inventory.json (tables, indexes, policies, triggers, constraints, function signatures, search_path/SECURITY DEFINER and EXECUTE ACLs). General run results: scripts/phase4-verification-results.json.

**NOT VERIFIED:** installation in an actual Supabase platform stack, platform extension versions, GoTrue-managed auth schema, deployed owners/memberships, hosted catalog drift. A plain local PostgreSQL shim is explicitly not a Supabase installation. Demo convenience SQL and credential-bearing seed paths are excluded from hosted upgrade instructions.

## E. Migration Verification

**CONFIRMED locally:** the original Git HEAD pre-upgrade schema with synthetic clinical history is upgraded through fix_phase1_security.sql → fix_phase2_booking_availability.sql → fix_phase3_notifications_reports.sql → fix_phase4_readonly_report_auth.sql. Each step and the repeated entire chain preserve ordered snapshots of eight clinical tables, UUIDs, roles, notes, appointment/audit history and uq_doctor_slot OID. Both report RPCs execute under BEGIN READ ONLY in the upgraded database; patient/anonymous/private-helper access is denied.

Invalid zero-duration/overlapping schedules and blank demographics fail their preflight migration transaction without deleting/rewriting records. Existing Phase 2 non-minute fixtures and Phase 1 exact-slot protections remain tested. The report fix independently reproduces the legacy read-only failure before applying the incremental fix, checks repeatability and verifies row/catalog preservation.

**HOSTED DEPLOYMENT NOT VERIFIED:** real project function definitions/data were not read or modified. For an installation already on Phase 1–3, manually review/apply only supabase/fix_phase4_readonly_report_auth.sql to isolated staging, then test both pages, actual PostgREST RPC denial, owners/ACLs and schema-cache refresh. No schema.sql/full.sql/full_demo.sql/db reset on an existing project.

## F. Authentication Verification

**CONFIRMED at local boundaries:** mounted real hooks reject stale identity results, clear previous patient state immediately, finish missing/failed linkage with explicit errors, fail wrong roles closed, clean listeners and use local signout. SQL ensure_patient_identity provisions patient-only records for an exact Auth UUID and never matches names; concurrent provisioning creates one link. admin_link_patient refuses an identity already attached elsewhere.

Actual built React/Supabase SDK in Chrome and Edge exercised synthetic password rejection, signup, identity provisioning response, reload/session restoration, query/identity error recovery, two storage keys, wrong-role restored sessions, logout/login and local signout isolation. Both unrelated portal keys coexist; staff signout leaves the patient key; patient signout removes its own key.

No hosted account or personal browser profile was used. Auth/token responses remain synthetic. New browser REST/RPC responses execute actual local PostgreSQL through a verification translator. **NOT VERIFIED:** real signup/email confirmation, Auth password policy/email delivery, real refresh/revocation/expired-session behavior, multi-device/global logout, actual gateway JWT verification and reset/password-change delivery. Missing patient SQL provisioning is tested; a genuine hosted missing-record failure remains unverified. Password reset is deliberately clinic-assisted, not an email workflow.

## G. RLS / Authorization Verification

All important denial decisions below were exercised under PostgreSQL roles/auth.uid(), not inferred from hidden React controls. Patient A/B are separate synthetic UUIDs. Admin authorized clinic operations remain functional.

| Actor/action | Local result | Evidence |
|---|---|---|
| Anonymous protected profile/patient/appointment/ledger reads | Denied or no rows | Phase 4 anonymous assertions |
| Anonymous table mutation, booking/private/admin RPC | Denied | Phase 1/4 EXECUTE/table ACL |
| Patient A own profile/patient/appointments | Allowed | Phase 1/4 RLS reads |
| Patient A Patient B private rows/update | No rows/no mutation | Phase 4 RLS assertions |
| Patient A own eligible book/reschedule/cancel | Allowed | Phase 1/4 RPC lifecycle |
| Patient A Patient B move/cancel | Denied | Owner RPC assertions |
| Patient A direct clinical/completed/check-in writes | Denied | No appointment mutation grant |
| Patient A staff booking/admin role RPC | Denied | Explicit backend role checks |
| Patient A report/worker RPC/other notification ledger | Denied/zero rows | Phase 3/4 grants/RLS |
| Admin booking/calendar/status/report/demographics | Allowed when valid | Phase 1–4 actual SQL |
| Admin self-demotion and invalid role | Denied | admin_set_profile_role regression |

Role-escalation attempts: direct UPDATE own role; INSERT explicit admin role; ON CONFLICT UPSERT role; admin_set_profile_role as patient; malformed UUID; extra ensure_patient_identity arguments; forged user_metadata/app_metadata role claim. All fail or are ignored, while profile device_label/permitted fields still update. Changing a frontend payload cannot add a granted role column or bypass SQL authorization. The HTTP browser facade is synthetic: **actual REST/table mutation at deployed PostgREST is NOT VERIFIED**, although its underlying SQL ACLs are tested.

profiles permits only granted safe profile columns; administrative role changes require the protected RPC/trusted backend. appointments permits browser SELECT, no direct INSERT/UPDATE/DELETE for either portal. patients ownership plus column-limited updates protect Auth linkage. Doctors/schedules/blocked dates/notes are admin writes with validation; reports admin-only; ledger is admin read and service worker only. SECURITY DEFINER safe search_path and explicit ACLs are regression-tested, including temporary-table spoofing.

Database owners/service_role remain trusted and may bypass browser rules. Unknown deployed functions, role memberships, superuser/owner rights and previously escalated admins require staging/private review. No claim that local RLS repairs an unapplied hosted database.

Read-only report regression additionally proves missing-profile/patient/anonymous/NULL/unknown callers fail closed; private helper EXECUTE is revoked; qualified SECURITY DEFINER lookup resists temporary-object shadowing; all 12 read-only SQL/PLpgSQL public application call graphs have no write/row-lock path. Concurrent read authorization permits a separate actor-profile update without waiting; mutation cancellation still blocks that update while holding intended authorization locks. Direct appointment writes and self-promotion remain denied.

## H. Patient E2E

**CONFIRMED local Chrome/Edge with real SQL and synthetic Auth:** login/wrong-password/signup response, SQL patient identity loading, all named direct-refresh routes, demographic save and reload, doctor/date/slot/book → reschedule → cancel → history, actual persisted SQL records, query/identity Retry, SDK storage restoration, wrong-role closure, local logout/login and patient/staff isolation. Slot availability and all patient RPC authorization execute actual local SQL rather than mocked business responses. Clinic display remains identical under Manila/UTC/New York.

**LOW / STILL BROKEN:** successful patient profile save loses its success message during identity refresh. Actual SQL save and reloaded fields pass; Profile awaits refreshPatient(), IdentityCoordinator publishes loading and PatientLayout unmounts the child, so the old form's setMsg does not survive. Earlier message assertions reproduced this twice; current SQL-browser evidence records the observation. No security/data loss or report blocker was found; no unrelated UI change was made.

**NOT VERIFIED complete connected E2E:** genuine Auth registration, email confirmation, password policy/change/reset, refresh/expiry/revocation/gateway JWT behavior and real PostgREST/RLS HTTP semantics. The local transport parses synthetic fixture tokens and does not validate their signatures. Provisioning fixture Auth users were inserted privately into disposable SQL; synthetic signup returns that fixture identity. No real SMS or hosted data is used.

## I. Staff E2E

**CONFIRMED local Chrome/Edge with real SQL and synthetic Auth:** protected login/dashboard/all route refresh, patient create/search/edit with persisted address, doctor create/edit/activate/deactivate, schedule create/remove and block/unblock, protected staff booking/move/cancel, today's synthetic visit check-in → waiting → room → in_progress → note → completed, database-persisted status/room/note, report/audit rendering, CSV generation and real-query Retry, logout preserving patient session. The visit fixture uses today because future-day clinical progression must be denied; it is not represented as future bookings being checked in.

Phase 2/3 mounted/SQL suites retain exact-UUID linkage/conflict denial, demographic/calendar validation, invalid/terminal/skipped transitions, safe profile/role settings and pending mutation verification. Staff role remains database admin; no new role was introduced.

**NOT VERIFIED:** genuine complete staff Auth/PostgREST E2E, live password updates/expired sessions, private proof for a real Auth identity link, full responsive/accessibility matrix and operational notification delivery. Real identity-link and settings actions still require an isolated staging browser rehearsal; source/SQL/mounted coverage is not substituted for that integration.

## J. Booking / Availability / Concurrency

**CONFIRMED locally:** uq_doctor_slot is UNIQUE (doctor_id, scheduled_time), partial WHERE status NOT IN ('cancelled','no_show'). It is unchanged and its OID preserved across upgrades. Exactly one request wins each controlled race: Patient A vs B; patient vs staff; staff vs staff; reschedule vs booking; reschedule vs reschedule. A failed move retains its original appointment through transactional rollback.

09:00:00 on the schedule grid books; 09:00:01, 09:00:00.500 and off-grid 09:01 are rejected. Patient and staff writes call the same validator; direct browser writes are denied. Cancelled/no_show release exact slots; completed remains occupied. Availability returns only scheduled_time and slot_duration_minutes, not another patient's ID/name/reason/appointment row.

Scenario evidence: Phase 2/4 compare identical arrays for empty, partial, full, cancelled/no-show/completed, unavailable and inactive cases; current-day past slots are excluded; future weekday schedules apply; duplicate/overlapping/invalid duration rows fail; booking vs blocking serialization prevents conflicting commits. Blocking an occupied doctor date returns success:false/conflict_count and inserts no block. Existing valid/history rows stay preserved.

**ACCEPTED LIMITATION:** uniqueness protects exact starts, not overlapping intervals across a changed schedule grid and old visits at different starts. Schedule changes do not rewrite old visits; safe migration/history policy requires operator review of such cases. A stronger interval-history invariant was not silently introduced in verification. Previously existing blocked-date conflicts are preserved and need private reconciliation. Actual hosted occupancy/index/locks remain NOT VERIFIED.

## K. Timezone Verification

**CONFIRMED locally:** clinicTime.ts fixes Asia/Manila for clinicInstant, clinicDateKey/TimeKey, day/month half-open ranges, exact week dates and all format helpers. TypeScript strings map to PostgreSQL timestamptz instants; schedule TIME and blocked DATE retain clinic-calendar meanings. 2030-10-10 09:00 Manila equals 2030-10-10T01:00:00Z.

Phase 2 spawns Node under Asia/Manila/UTC/America/New_York and compares date/time/display/day/month/week results. PostgreSQL session timezones return equal slot epochs. Phase 3 verifies report UTC/Manila midnight and reminder morning/tomorrow boundaries. Chrome/Edge Emulation.setTimezoneOverride yields identical actual appointment list strings across all three zones.

Booking/rescheduling/backend check-in/report/reminder date logic and blocked/exact-week displays use shared clinic rules and local regressions. **NOT VERIFIED:** each complete real-provider/hosted/browser report/dashboard/history/blocked-week workflow under all three zones. Long-open dashboard day/week rollover has no dedicated clock subscription; refresh/reopen at clinic midnight is an accepted LOW limitation. Reminder fixtures inject a clock; no scheduler waited for real time.

## L. Notifications / Reminder Verification

**CONFIRMED locally:** committed approved appointment operations enqueue one versioned confirmation/reschedule/cancellation event through phase3_enqueue_notification; transaction failure enqueues nothing. Queue/claim/finish/result functions are service-only; ownership request RPC is owning patient/admin. Actual _shared/handlers.ts connects to the real local ledger through a JSON RPC adapter and a mocked Twilio transport. Repeat confirmation sends once. Accepted status is separate from delivery_status; callback SQL records delivered without changing provider acceptance.

Phase 3 handler tests cover OPTIONS/exact CORS, valid/invalid/null/missing/UUID JSON, unauthorized caller and patient/admin paths. Provider 400 is failed/rejected; 429 retry-aware failed; 500/network timeout unknown/held, not accepted. Booking stays committed for every failure. Mock tests exercise invalid destination, duplicate calls, SQL concurrent claim, bounded retries, lease expiry, stale supersession, reminder cancellation/reschedule and independent HMAC signature rejection. Logs/responses omit private destinations/message bodies/provider secrets.

Reminders select the next Manila clinic date after a 07:00 clinic-time gate; durable (appointment,type,revision,channel) uniqueness prevents duplicates. Cancelled/completed/no_show appointments are not newly reminded; reschedule supersedes the old revision and claims use the new instant. Ambiguous/expired/stubbed sends are held for operator reconciliation, not blindly replayed. Already-in-flight provider requests cannot be recalled.

Scheduler definition supabase/fix_phase3_scheduler.sql requires Phase 3, Vault/pg_cron/pg_net and three named Vault secrets. _invoke_notification_worker uses empty search_path, qualified net.http_post, cron-secret + anon headers, correct /functions/v1/send-reminders suffix, 10s queued HTTP timeout. Intended named job medicappointment-notification-worker runs */5 * * * *. Phase 3 tests install mocked Vault/net/cron and verify structure/idempotent name, not real extension execution.

**NOT VERIFIED:** installed Vault/cron/net, exactly one live job, actual project URL/auth, worker HTTP runtime, real Twilio acceptance/delivery, callback public URL/signature transport/early retries, quota/consent and backlog. Five-message batches per five-minute pass require staging capacity measurement; notifications are operationally PARTIAL, and automated hosted reminders are not claimed operational. No test destination was sent a real message.

## M. Reports / CSV Verification

**FIXED LOCALLY / HOSTED DEPLOYMENT NOT VERIFIED:** Dashboard (/appointments/dashboard) and Reports (/appointments/reports) call staff_appointment_report; Reports also calls staff_report_audit. Legacy STABLE report → _require_admin() → profiles SELECT FOR SHARE caused the PostgreSQL read-only exception. The separate private _require_admin_readonly() uses auth.uid(), a qualified admin-profile EXISTS check, safe SECURITY DEFINER search_path and explicit ACLs, with no locks/writes. Reports remain STABLE. SELECT-only admin_patient_duplicate_count follows this path; protected mutation authorization retains locking behavior.

The 14-group report regression passes both RPCs in READ ONLY, observes missing-role/anonymous/patient denials, no mutation/row-lock behavior and preserved mutation locks/security. Mounted actual Dashboard/Reports/StaffLayout use real SQL and verify data, totals, empty states, actual query error/Retry and portal denial. SQL-backed Chrome/Edge additionally exercise both pages, audit entries, generated CSV Blob and Retry. No error was hidden in React.

Totals: Phase 3 manually checks 1,505 visits and audit 100+5; independent Phase 4 oracle checks 1,211 visits across eight statuses (4 no-shows, 1,201 cancelled, 3 walk-ins), same-name/different-ID doctor/patient isolation, midnight/date/doctor/empty filters and 185 audit entries paged 100+85. Results match three SQL session timezones; no REST-cap truncation. Date ranges remain limited/validated.

csv.ts quotes every cell, doubles quotes, emits UTF-8 BOM/CRLF and prefixes formula/control/whitespace-leading dangerous strings. Malicious fixtures retain Unicode, commas, quotes and embedded newlines. Historical actual Excel normal Workbooks.Open of synthetic CSV found no formulas and preserved values; forced OpenText split a newline and is an accepted importer limitation. Evidence phase4-spreadsheet-results.json and phase4-synthetic-export.csv remains valid because the encoder hash is unchanged.

**NOT VERIFIED:** hosted migration/cache/owners/ACLs, a live-record browser download through PostgREST, other spreadsheet apps/import locales, production volume. Full report-fix details remain in MEDICAPPOINTMENT_PHASE4_REPORT_FIX.md; it was not rewritten by this continuation.

## N. Realtime Verification

**CONFIRMED mocked/source:** advertised staff Realtime is implemented in staffAuth/useAppointmentRealtime, feeding Phase 2 invalidation with one admin appointment channel and burst debounce. Mounted Phase 3 tests assert role/unmount cleanup, timer cleanup, no duplicate channel/refresh storm and no patient subscription. Same-client mutation refresh works independently of Realtime and is tested by actual mounted Booking handlers.

enable_phase3_realtime.sql only adds appointments to an existing supabase_realtime publication if absent, keeps DEFAULT replica identity and does not broaden RLS. **NOT VERIFIED:** actual two-admin-browser event transport, reconnect, hosted RLS filtering/replication configuration and patient event isolation. Browser harness deliberately disables remote WebSockets, so its two SDK sessions provide no live Realtime evidence. Optional publication installation is required before claiming advertised cross-client updates; patient remote updates remain intentionally absent.

## O. Browser / Routing Verification

SQL-backed browser result boundary: Actual built React/SDK and real disposable PostgreSQL RPC/ACL/RLS; Auth synthetic, REST translated locally (NOT GoTrue/PostgREST), all non-loopback HTTP intercepted and remote WebSockets replaced; hosted E2E NOT VERIFIED. Every non-loopback HTTP request is intercepted; remote WebSockets are redirected offline. Isolated headless Chrome/Edge use new temporary profiles, actual dist/React/SDK and loopback SPA history fallback. No personal browser profile is used.

| Browser | Check | Result |
|---|---|---|
| Chrome | root/anonymous protected routes redirect to correct portal login | PASS |
| Chrome | wrong password visible; patient signup, provisioning and dashboard render | PASS |
| Chrome | patient direct refresh routes render with restored real SDK session | PASS |
| Chrome | patient doctor/date/slot/book → list → reschedule → cancel → history | PASS |
| Chrome | patient query error/retry and failed identity are explicit rather than indefinite/empty | PASS |
| Chrome | patient session alone cannot access staff; independent admin login restores staff routes | PASS |
| Chrome | patient demographic save persists through SQL and refresh | PASS |
| Chrome | staff creates, searches and edits a clinic patient with SQL persistence | PASS |
| Chrome | staff doctor create/edit/activate and working-hour/block CRUD persists through SQL | PASS |
| Chrome | staff books, moves and cancels through protected SQL RPCs | PASS |
| Chrome | staff check-in, waiting, room, completion and visit note persist with audit | PASS |
| Chrome | staff Dashboard/Reports real SQL totals, audit, CSV and Retry recover | PASS |
| Chrome | separate SDK storage keys coexist; admin logout preserves patient session | PASS |
| Chrome | wrong-role restored sessions fail closed in both portals; patient logout and login again work | PASS |
| Chrome | clinic appointment display identical under Manila/UTC/New York browser timezones | PASS |
| Chrome | mobile viewport login/patient/booking and invalid nested route behavior | PASS |
| Chrome | Business data persisted in disposable local PostgreSQL | PASS |
| Edge | root/anonymous protected routes redirect to correct portal login | PASS |
| Edge | wrong password visible; patient signup, provisioning and dashboard render | PASS |
| Edge | patient direct refresh routes render with restored real SDK session | PASS |
| Edge | patient doctor/date/slot/book → list → reschedule → cancel → history | PASS |
| Edge | patient query error/retry and failed identity are explicit rather than indefinite/empty | PASS |
| Edge | patient session alone cannot access staff; independent admin login restores staff routes | PASS |
| Edge | patient demographic save persists through SQL and refresh | PASS |
| Edge | staff creates, searches and edits a clinic patient with SQL persistence | PASS |
| Edge | staff doctor create/edit/activate and working-hour/block CRUD persists through SQL | PASS |
| Edge | staff books, moves and cancels through protected SQL RPCs | PASS |
| Edge | staff check-in, waiting, room, completion and visit note persist with audit | PASS |
| Edge | staff Dashboard/Reports real SQL totals, audit, CSV and Retry recover | PASS |
| Edge | separate SDK storage keys coexist; admin logout preserves patient session | PASS |
| Edge | wrong-role restored sessions fail closed in both portals; patient logout and login again work | PASS |
| Edge | clinic appointment display identical under Manila/UTC/New York browser timezones | PASS |
| Edge | mobile viewport login/patient/booking and invalid nested route behavior | PASS |
| Edge | Business data persisted in disposable local PostgreSQL | PASS |

All actual named patient/staff direct URLs reload and restore the appropriate independent SDK session. Root/outer wildcard/legacy queue-board redirect patient login; anonymous protected routes redirect their portal login. Invalid nested patient route remains blank (accepted LOW limitation, no role bypass). The patient booking mobile viewport is 390×844 and fits horizontally; screenshots are scripts/phase4-sql-chrome-mobile.png and phase4-sql-edge-mobile.png. Historical screenshots were visually inspected; this continuation verifies width and functionality, not every page's visual/accessibility behavior.

**NOT VERIFIED:** real deployment HTTPS/history fallback, real browser Auth/PostgREST requests, staff responsive/modal matrix, assistive technologies, live Realtime/reconnect. Verification REST translation intentionally returns accessible full rows rather than complete PostgREST projection semantics, so it cannot certify production transport behavior.

## P. Secret / Demo Account Hygiene

git ls-files .env returns no entry: **untracked**. git ls-files secret.txt returns its filename: **tracked**. Contents were privately scanned without outputting values. JWT-like material is present and the parsed role category is **anon**; password/service-role-token category was not detected. This is not proof of a privileged service-role credential leak: an anon public key is normally frontend material and still depends on RLS. Current validity/signature, any non-JWT credential format, old history and deployed key permissions were not independently verified.

Required private hygiene review: remove unnecessary credential files from tracking through a separately reviewed change, inspect history privately, rotate any exposed nonpublic credentials if discovered, and review history cleanup if appropriate. Do not indiscriminately rotate a project signing secret based solely on an anon-role claim, and do not rewrite history automatically. No file/credential rotation was performed in this verification phase.

Demo account/password definitions remain in the local seed.cjs; no passwords are reproduced here. The script refuses non-loopback targets; README/setup explicitly require removing/rotating deployed demonstration identities. full.sql contains demo data. No hosted account inventory or seeder was run. Isolated school/demo synthetic identities are acceptable; real production must prove known default accounts are absent or rotated. Existing admin legitimacy must be reviewed because past escalation cannot be inferred/repaired by a preserving migration.

.env.example contains fake frontend values and server secret names only. Browser request metadata was classified without printing keys; see frontendCredentialRoleCategories in phase4-browser-results.json. That local claim classification is not a hosted credential audit. Secrets belong only in Edge secret manager/Vault; service-role must never enter VITE_* or frontend code.

Current categorical scan: scripts/phase4-postfix-environment-hygiene.json. .env remains untracked, secret.txt tracked, parsed JWT role category anon only; no privileged VITE variable names detected. This is not a complete non-JWT credential/history audit. full.sql, full_demo.sql and demo_data.sql contain demo/bootstrap material and must never be applied as existing hosted upgrades. No credential values appear in current evidence. Docker is unavailable and the installed Supabase CLI wrapper cannot find its Windows binary; no full local platform or isolated staging target was available. Live verification gaps were explicitly retained.

## Q. Original Audit Finding Traceability

| Original Finding | Original Severity | Phase Fixed | Current Status | Evidence |
|---|---|---|---|---|
| E1 patient self-promotion | CRITICAL | 1 | FIXED | Column ACL/default role/admin RPC; Phase 1/4 attacks |
| E2 unrestricted appointment writes | CRITICAL | 1 | FIXED | SELECT-only browsers; authorized RPCs; Phase 1/4 |
| E3 patient picker advertises other occupied slots | HIGH | 2 | FIXED | Privacy-safe common availability; Phase 2/4 |
| E4 seconds/fractions and overlapping schedule slots | HIGH | 2 | FIXED | Minute/grid CHECK/validator + schedule exclusion; exact-start interval limitation separate |
| E5 duplicate/overlap/zero duration schedules | HIGH | 2 | FIXED | CHECK/GiST exclusion; safe incompatible rollback |
| E6 truthy/restored wrong role guard | HIGH | 1–2 | FIXED | Exact role; mounted and Chrome/Edge wrong-role cases |
| E7 auth stale identity/races | HIGH | 2–3 | FIXED | Generation/atomic packet/deadlines/listener cleanup |
| E8 name linking/ignored linkage failure | HIGH | 2–3 | FIXED | Exact UUID provisioning/link RPC; explicit failures |
| E9 reschedule fallback new booking/false success | HIGH | 1 | FIXED | Fail closed RPC-only; rollback/ownership |
| E10 edited reschedule reason ignored | MEDIUM | 3 | FIXED | Reason explicitly read-only for reschedule; authoritative original retained |
| E11 staff upcoming list stale | MEDIUM | 2 | FIXED | Shared mutation invalidation; actual mounted handlers |
| E12 check-in date/status/timestamp/pending | HIGH | 1–3 | FIXED | Backend clinic-day/state/timestamp; pending handled |
| E13 browser/server clinic timezone | HIGH | 2–3 | FIXED | Shared Manila utilities, SQL and browser timezone tests |
| E14 reports names/dates/truncation | MEDIUM | 3 | FIXED | Admin SQL ID aggregates/paging; 1,505 fixture total |
| E15 notification CORS | HIGH | 3 | FIXED | Real handler OPTIONS/exact origin; offline tests |
| E16 provider failure falsely successful | HIGH | 3 | FIXED | Structured accepted/stubbed/error/delivery and ledger |
| E17 null/malformed notification payload | MEDIUM | 3 | FIXED | Bounded body/UUID/type/auth validation |
| E18 status/reschedule/cancel races | HIGH | 1–2 | FIXED | Locks/transactional allowed transitions |
| E19 missing validation/repeated submit | MEDIUM | 1–3 | FIXED | Backend form triggers/constraints + sync mutation gate |
| E20 policy drop/rerun migration defect | MEDIUM | 1 | FIXED | Transactional canonical security copies; repeat full chain |
| E21 Leave from unrelated week | MEDIUM | 2 | FIXED | Exact displayed clinic-week dates regression |
| Tracked secret.txt | HIGH | Review 4 | NOT VERIFIED | Tracked anon-role JWT found; privileged leak not confirmed; validity/history review outstanding |
| Embedded demo/default credentials | HIGH if deployed | 3 partial | NOT VERIFIED | Loopback guard/docs fixed; actual deployed accounts unknown |
| Insufficient SECURITY DEFINER hardening | MEDIUM | 1–3 | FIXED | Safe search_path/qualified tables/explicit EXECUTE; actual hosted owners unknown |
| Notification stub PII/body logs | HIGH | 3 | FIXED | Minimal metadata/no sensitive payload/provider logs |
| CSV formula injection | MEDIUM | 3 | FIXED | Shared encoding + malicious fixtures + actual Excel normal open |
| Overbroad table grants | MEDIUM | 1–3 | FIXED | Role/appointment/linkage column and worker ACLs; hosted drift unknown |
| F missing auth-column protection/staff validation/state machine | Not separately rated | 1 | FIXED | Protected role/staff RPC/lifecycle |
| F missing privacy-preserving availability | Not separately rated | 2 | FIXED | Slot/date RPC only safe data |
| F reminder installed executable job | Not separately rated | 3 definition | NOT VERIFIED | Deployable Vault cron exists; no live job installed/verified |
| F notification ledger/retries/idempotency | Not separately rated | 3 | FIXED | Versioned outbox/claim/finish/callback tests |
| F frontend Realtime missing | Not separately rated | 3 code | NOT VERIFIED | Subscription code/mocks pass; actual publication/transport unknown |
| F doctor name/specialty editing missing | Not separately rated | 3 | FIXED | Validated non-destructive doctor edit UI/backend |
| F patient archive/delete | Not separately rated | None | ACCEPTED LIMITATION | No requirement/specification justified destructive CRUD; history preserved |
| F intentional clinic/Auth linkage absent | Not separately rated | 2–3 | FIXED | Admin exact UUID link/form/conflict refusal |
| F automated behavioral/concurrency tests absent | Not separately rated | 1–4 | FIXED | Runnable safe SQL/hooks/browser suites |
| Email/Resend, PDF/Excel export/print, clinic-wide closure | Not required | None | ACCEPTED LIMITATION | SMS/CSV/doctor-specific blocking only; no unsupported claims |
| Self-service password recovery | Not required | 3 truthful UX | ACCEPTED LIMITATION | Explicit clinic-assisted help; no reset-email workflow |
| H Auth user can lack profile/patient | Not separately rated | 2 | FIXED | Provisioning RPC/explicit failure; real Auth trigger not assumed |
| H unlinked patients and Auth deletion SET NULL | Not separately rated | 2 preserved | ACCEPTED LIMITATION | Intentional clinic records/history; verified exact links only |
| H missing schedule/appointment grid constraints | Not separately rated | 2 | FIXED | Minute grid/duration/overlap; catalog and rejected fixtures |
| H blocked date can conflict with active visit | Not separately rated | 2 | FIXED | New conflicting block refused; historical conflicts preserved for review |
| H nullable doctor flags | Not separately rated | None | ACCEPTED LIMITATION | NULL not treated as active; no unrelated history rewrite |
| H recurrence ownership/cycle integrity | Not separately rated | 1 partial | ACCEPTED LIMITATION | Authorized follow-up parent validation; trusted backend remains privileged |
| H visit note patient/appointment mismatch | Not separately rated | 3 | FIXED | Form trigger matches linked appointment/patient and creator |
| H empty/whitespace/oversized text | Not separately rated | 3 | FIXED | Backend validators/preflight plus frontend errors |
| H audit only appointment inserts/updates | Not separately rated | Preserved | ACCEPTED LIMITATION | No full demographic/delete audit added; browser appointment deletes denied |
| H IF NOT EXISTS cannot validate arbitrary live schema | Not separately rated | 1–3 preflight | NOT VERIFIED | Critical index/rows checked locally; real drift requires review |
| H legacy queue columns retained | Not separately rated | 1 documented | ACCEPTED LIMITATION | Modern fresh schema clean; matching legacy history retained intentionally |
| History inactive doctor join missing | Not separately rated | 3 | FIXED | Patient can read own historical inactive doctor |
| O missing dependencies/build could not run | Tooling | 1–4 | FIXED | Clean npm ci and final TypeScript/Vite pass |
| O Edge code not in tsconfig scope | Not separately rated | 3 | FIXED | Seven-file offline Edge type verification; actual Deno runtime unknown |
| O Save User decorative checkbox | LOW | 3 | FIXED | Removed; truthful persistent-session wording |
| O notification setting display-only | Not separately rated | 3 documented | ACCEPTED LIMITATION | Deployment flag display, not editable provider configuration |
| O independent room save absent | Not separately rated | Preserved | ACCEPTED LIMITATION | Room persisted with authorized clinical transition |
| O visit-note read interface absent | Not separately rated | Preserved | ACCEPTED LIMITATION | Safe creation exists; reading interface deferred |
| O errors treated as empty/no mutation result/try-finally | Not separately rated | 2–3 | FIXED | QueryState/error/retry/returned rows/useMutation tests |
| O profile display-name context stale | Not separately rated | 3 | FIXED | Atomic patient/profile save + identity refresh |
| O staff-specific password hint in patient login | LOW | 3 | FIXED | Shared explicit clinic/admin-assisted wording |
| O obsolete semicolon/setup instructions and .env.example missing | LOW | 3 | FIXED | Fake template and current npm/setup instructions |
| O nested 404/application error boundary absent | LOW | None | ACCEPTED LIMITATION | Blank invalid nested route confirmed; external fallback remains |
| O hardcoded/mock frontend clinical/report data | No confirmed defect | Audit | ACCEPTED LIMITATION | No fake production data found; Phase 4 fixtures isolated in scripts |
| O optional live verification mutates hosted data | HIGH operational | 1 | FIXED | verify.mjs static; no environment connection/write branch |
| O broad table/REST fetching and report caps | MEDIUM/volume | 3 partial | ACCEPTED LIMITATION | Reports/history complete; some intentional bounded lookups remain |
| O schedule/patient-time/audit/trigram index suggestions | Performance | 2 partial | ACCEPTED LIMITATION | Schedule GiST/indexes present; other changes require volume evidence |
| O duplicate auth reads/stale filter response | Not separately rated | 2 | FIXED | IdentityCoordinator/RequestGeneration/abort tests |
| O repeated schedule/block reload and mutable multi-page snapshots | LOW | Preserved | ACCEPTED LIMITATION | Correctness maintained; not transactionally frozen browser pagination |
| O nonexistent frontend confirmed status | MEDIUM | 3 | FIXED | Removed as API/status value; display wording only |
| P1 existing historically compromised admin assignments | HIGH operational | Pending | NOT VERIFIED | Preserving migrations cannot judge legitimacy; private audit needed |
| P1 trusted backend/service-role/unknown RPC rights | HIGH operational | Boundary preserved | NOT VERIFIED | Local browser ACLs pass; hosted owner/membership/RPC drift unknown |
| P2 real extension/owner/auth.users lock compatibility | HIGH operational | Pending staging | NOT VERIFIED | Plain PostgreSQL 18 shim passes; platform setup unknown |
| P2 real bad schedules/non-minute/blocked historical visits | HIGH operational | Safe rejection | NOT VERIFIED | Fixture rollback confirmed; actual real rows not inspected |
| P2 schedule grid changes can overlap old interval starts | MEDIUM | Not changed | ACCEPTED LIMITATION | Only exact-start uniqueness promised; operator reconciliation needed |
| P2 long-open dashboard midnight/week rollover | LOW | Not changed | ACCEPTED LIMITATION | Shared timezone correct; refresh at rollover required |
| P2 duplicate account/history-link conflicts | MEDIUM | 2–3 controlled | ACCEPTED LIMITATION | Refusal correct; no automatic merge/delete |
| P3 simultaneous demographic duplicates | MEDIUM | 3 partial | ACCEPTED LIMITATION | Draft UUID/review warning, not demographic global uniqueness |
| P3 ambiguous sends/expired leases/stubs/in-flight changes | MEDIUM | 3 conservative | ACCEPTED LIMITATION | Manual reconciliation; no unconditional retries/retraction |
| P3 callback retry/public URL/throughput/quota/consent | HIGH/MEDIUM operational | Pending staging | NOT VERIFIED | Mock signatures/queue tests only |
| P3 hosted Auth/password/email-confirmation policy | HIGH operational | Pending staging | NOT VERIFIED | Local config does not configure hosted policy |
| P3 spreadsheet rendering/file exports | MEDIUM | 4 partial | NOT VERIFIED | Normal Excel synthetic open passes; live export/other importers unknown |
| P3 hosted scheduler/publication/function deployment | HIGH operational | Pending staging | NOT VERIFIED | Only repository definitions/local mocks |
| P3 live two-client Realtime/reconnect/privacy | MEDIUM | Pending staging | NOT VERIFIED | Mounted cleanup/isolation only; no remote subscription |
| P3 demonstration seeder generation | Operational | Not run | NOT VERIFIED | Target refusal tested; no hosted/local accounts seeded |
| P3 Vite large bundle warning | LOW | Deferred | ACCEPTED LIMITATION | Build warning remains; no feature/performance redesign |
| New dependency security advisories | HIGH/MODERATE | 4 review | STILL BROKEN | Current npm audit exit 1: nine package classifications, six high/three moderate; versions retained |

FIXED denotes tested current workspace source/local SQL; actual hosted installation is separately NOT VERIFIED. Every numbered E1–E21, security finding, missing-capability group, database/UI/performance finding and prior-report unresolved category is represented, including intentional unsupported features. No original finding is silently treated as a deployed fix.

Additional Phase 4 release-blocker (separate from original E1–E21): Dashboard/Reports SELECT FOR SHARE read-only failure — **FIXED LOCALLY; HOSTED DEPLOYMENT NOT VERIFIED**. Evidence: MEDICAPPOINTMENT_PHASE4_REPORT_FIX.md, incremental migration and 14-group report regression. Existing original report-total finding retains its original traceability; the new authorization defect is not silently treated as the same finding.

Additional LOW browser finding: patient profile save confirmation lost during identity refresh — **STILL BROKEN**, with successful persisted SQL/reloaded fields. Evidence in H and SQL-browser observations. Deferred within verification-first scope; no report/security/clinical-data regression.

## R. Remaining Known Limitations

**STILL BROKEN:** dependency audit flags nine packages: braces, chokidar, fast-glob, micromatch, tailwindcss, vite, esbuild, react-router and react-router-dom. Six high/three moderate classifications include inherited dependency chains, not nine independent exploitable defects. The old four-package snapshot is historical. No automatic dependency upgrades were performed.

**LOW / STILL BROKEN:** patient profile save success message disappears during identity refresh; the mutation and refreshed fields succeed. See H. This remains documented rather than broadening the narrow release verification into unrelated UI work.

The newly reported braces issue concerns deeply nested patterns exhausting recursive tree walkers; the audit propagates this through build/watch/glob dependencies. Whether an attacker can supply such patterns to this project's tooling was not verified. [Upstream report](https://github.com/micromatch/braces/issues/70). Vite's Windows filesystem-deny bypass requires network-exposed dev-server conditions; static dist serving does not run that server. [Vite advisory](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff). Router redirect and SSR advisories remain flagged; the app's declarative/fixed-internal navigation suggests narrower exposure, an inference rather than remediation. [Redirect advisory](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6), [SSR advisory](https://github.com/remix-run/react-router/security/advisories/GHSA-337j-9hxr-rhxg). Exact registry metadata: scripts/phase4-postfix-dependency-audit.json.

**NOT VERIFIED:** staging/hosted report migration; actual Auth/PostgREST/JWT/RLS REST attacks and complete patient/staff E2E; deployed schema/owners/ACLs and real-data preflight; historical admin legitimacy; current key validity/non-JWT formats/history/default accounts; live provider/signature callback/consent/quota; installed Vault/cron/net/job outcomes; live two-client Realtime/privacy/reconnect; operational backup/restore, HTTPS/history fallback, production load, all importers and responsive/accessibility behavior.

**Accepted existing limitations:** exact starts rather than interval overlap across old schedule-grid changes; no automatic history merge/demographic uniqueness; uncertain/in-flight external sends need reconciliation; bounded worker capacity unmeasured; clinical note-reading/independent room-save UI absent; nested blank 404/no error boundary; long-open midnight refresh; >500 kB bundle warning and bounded list snapshots. No unrelated features, role changes, RLS changes or notification/scheduling redesign were added. Detailed original classifications remain in Q.

## S. Exact Deployment Order

Inventory only; no deployment occurred. Choose fresh versus existing installation after private catalog review, never combine blindly.

| Order | File/action | Classification/condition |
|---|---|---|
| 0 | Isolated staging target, backups/catalog/data/admin review | Required before an existing installation upgrade |
| 1 | supabase/fix_phase1_security.sql | Required if Phase 1 not already installed |
| 2 | supabase/fix_phase2_booking_availability.sql | After Phase 1, if Phase 2 not installed; stop on preflight errors |
| 3 | supabase/fix_phase3_notifications_reports.sql | After Phase 2, if Phase 3 not installed; preserve transactional preflight |
| 4 | **supabase/fix_phase4_readonly_report_auth.sql** | **Required report fix; only SQL migration needed when Phase 1–3 already installed** |
| 5 | Edge functions/send-confirmation, send-reminders, notification-status and config/shared modules | Required for connected notifications; stage gateway/origins/secrets |
| 6 | supabase/fix_phase3_scheduler.sql | Required when claiming automated reminders, otherwise optional; configured Vault/cron/net and worker |
| 7 | supabase/enable_phase3_realtime.sql | Required when claiming cross-client updates, otherwise optional; verify RLS/transport |
| 8 | Correct public config → npm ci → npm run build → static HTTPS dist with SPA fallback | Frontend release after reviewed backend/configuration |
| 9 | Actual staging report/dashboard/RPC/REST/privacy/browser/concurrency/provider/cron/Realtime evidence | Required release gates; apply schema-cache refresh through operational procedure if needed |
| Fresh only | supabase/schema.sql | Fresh non-demo installation includes current protection/fix definitions; private admin bootstrap |
| Legacy conditional | supabase/migrate_patient_booking.sql | Matching reviewed legacy setup only; not a blind modern upgrade |
| Compatibility only | supabase/fix_admin_reports_readonly.sql | Byte-identical compatibility alias; not an additional migration step |
| Do not use on existing hosted DB | schema.sql, full.sql, full_demo.sql, demo_data.sql, seed.cjs, supabase db reset | Fresh/demo/reset paths, not existing-project upgrades |
| Reference only | supabase/cron.sql | Pointer; use reviewed incremental scheduler migration |
| Test reconciliation only | supabase/reconcile_test_blank_patient_names.sql, reconcile_test_monday_schedules.sql | Not general release migrations; do not apply to real history blindly |

Server variables: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, NOTIFY_ALLOWED_ORIGINS, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER; optional NOTIFY_STATUS_CALLBACK_URL. Vault names: medicappointment_url, medicappointment_anon_key, medicappointment_cron_secret. Frontend: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, optional VITE_NOTIFY_ENABLED. No private values belong in frontend/report/Git.

For the reported hosted failure, manually review/apply supabase/fix_phase4_readonly_report_auth.sql in staging and test it before any hosted release. Existing installation cannot be certified fixed from workspace hashes alone. No reset, history/role rewrite or hosted demo seeding is authorized.

## T. School Demonstration Readiness

**NOT READY for a complete connected demonstration.** Local SQL-backed patient/staff browser exercises and code/test walkthroughs pass and can be shown honestly as isolated verification. Auth is synthetic, so this is not a functioning full Supabase demonstration deployment.

Rehearse a genuine isolated Auth/PostgREST stack with synthetic identities, reviewed migrations and both complete portal flows. A manually refreshed/notification-disabled demonstration can be accepted only with those limits declared. Do not use production patients or credential-bearing demo SQL on an existing hosted project.

## U. Staging Readiness

**READY WITH PREREQUISITES.** Local build/security/migration/browser checks pass and the report blocker is fixed locally. No new confirmed application defect requires additional source work in this continuation.

Needs a separately authorized isolated target, platform Auth/extension/owner compatibility, reviewed migration/preflight/backups, public config/exact origins/server secrets, synthetic accounts/destinations, dependency/hygiene disposition and actual HTTP E2E/adversarial checks. Report fix must be applied/tested there. Claimed automation/Realtime needs installed live evidence. This classification is not deployment authorization.

## V. Production Readiness

**NOT READY.** Hosted report fix, live security/Auth/integrations, role/key/history/demo review, dependency disposition, actual patient/staff E2E and operational recovery evidence remain missing. Local SQL and synthetic Auth cannot establish patient-operational readiness.

Production requires staging gates, ownership/ACL/schema-cache review, rollback/restore rehearsal, synthetic REST and concurrency attacks, secure hosting/monitoring/support, notification consent/destination/quota/unknown-send/callback operations and agreed historical schedule/link reconciliation. No production system was modified.

## W. Final Go/No-Go Conditions

GO only for a separately authorized isolated staging verification using S. NO-GO for production or a complete connected school demonstration without genuine backend rehearsal. Do not claim source scheduler/Realtime as installed, run demo/reset SQL on an existing hosted project, bypass preflight through history deletion, expose development servers/private secrets, or automatically replay uncertain sends.

All requested final regressions and additional Phase 4 checks pass; 82 source/configuration/SQL/package files and five historical reports remain unchanged since continuation began. The report covers A–W, original audit traceability and all 21 requested verification/readiness categories. Continuation/checklist are refreshed. **SELECT FOR SHARE: FIXED LOCALLY; HOSTED DEPLOYMENT NOT VERIFIED. Phase 4 local verification is complete and stops here.**
