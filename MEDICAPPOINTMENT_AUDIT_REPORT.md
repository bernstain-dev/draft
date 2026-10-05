# MedicAppointment — Complete Technical Audit Report

**Report timestamp:** 2026-10-02 19:32:53 Asia/Manila (2026-10-02 11:32:53 UTC)

**Workspace:** `D:\Development\Projects\draft`

## Audit Scope

- The audit was performed against the current MedicAppointment workspace.
- No destructive database operations were performed.
- No deployment was performed.
- Secrets were not intentionally exposed.
- Findings are based on inspected source code, SQL, configuration, and safe build/test results.
- The audit remained read-only with respect to application source code, database schema, production data, and deployed Supabase services.
- The only file created or modified to save this report is `MEDICAPPOINTMENT_AUDIT_REPORT.md`.
- This document preserves the complete final audit report below; unverified live behavior remains explicitly identified.

**Evidence classifications**

| Classification | Meaning |
|---|---|
| CONFIRMED | Established by inspected source/configuration or the stated safe local check; does not imply hosted operation unless explicitly stated |
| PARTIAL | Implemented in part, with missing, inconsistent, defective, or unverified behavior |
| BROKEN | A defect is established by source analysis or a stated isolated local reproduction |
| MISSING | No implementation was found for the specified capability |
| NOT VERIFIED | Evidence needed to establish runtime, hosted database, deployment, scheduling, concurrency, or delivery behavior was not obtained |

## A. EXECUTIVE SUMMARY

**MedicAppointment has substantial implementation, but it is not ready for real deployment. Its live functionality remains unverified, and the supplied SQL contains a critical privilege-escalation vulnerability.**

| Area | Assessment |
|---|---|
| Working in local checks | Shared slot generation for ordinary inputs, cancellation/no-show slot release, patient status labels, and the static verification script |
| Implemented but not operationally verified | Authentication, database-connected screens, patient RPCs, patient management, doctor management, reports |
| Partial | Notifications, reminder automation, appointment lifecycle validation, patient/Auth linkage, schedule management |
| Confirmed defects | Patient role escalation, business-rule bypass through direct writes, inaccurate patient availability, missing check-in timestamps, timezone inconsistencies, stale staff appointment lists, notification CORS and delivery reporting |
| Most serious risk | A patient can change their own database profile role to `admin`, gaining the permissions granted to administrators |
| School demonstration | Not yet confirmed ready. Dependencies are absent, build checks could not start, and important flows need correction and testing |
| Real deployment | **Do not deploy in the current state** |

**Verification boundary:** This was a read-only source audit with local, in-memory checks. No login, live database query, migration, deployment, or provider delivery was performed. Consequently, the hosted schema, actual RLS installation, deployed Edge Functions, cron jobs, and real notifications are **NOT VERIFIED**.

No project files were modified. The pre-existing deletion of `.env.example` remained unchanged. No credential values or patient records are reproduced below.

## B. ARCHITECTURE ACTUALLY FOUND

The project contains **30 files under `src/`, 10 under `supabase/`, and one verification script**.

| Location | Actual responsibility |
|---|---|
| `src/main.tsx` | React root, Strict Mode, `BrowserRouter` |
| [App.tsx](D:/Development/Projects/draft/src/App.tsx:23) | Entire route configuration |
| `src/components/` | `LoginShell`, login option controls, reusable password field |
| `src/lib/` | Supabase factory, types, slot generation, patient formatting, RPC error classification, theme |
| `src/pages/patient/` | Login/registration, dashboard, booking, appointment list/history, profile/settings, patient auth provider |
| `src/pages/appointments/` | Admin login, dashboard, booking, check-in, patients, doctors/schedules/unavailable dates, reports, settings, staff auth provider |
| `supabase/schema.sql` | Eight tables, RLS, indexes, appointment audit/update triggers, identity helpers and patient RPCs |
| `supabase/full.sql` | Same schema implementation plus demonstration data |
| `supabase/migrate_patient_booking.sql` | Upgrade of an older schema; retains some legacy differences |
| `supabase/functions/` | `send-confirmation`, `send-reminders`, shared notification helper |
| `supabase/cron.sql` | Entirely commented scheduler template |
| `supabase/rls_tests.sql` | Manual verification instructions and sample queries |
| `scripts/verify.mjs` | Static pattern checks plus an optional database-mutating live branch |
| `public/` | Login background and RHU image assets |

The frontend uses React 18, React Router 6, TypeScript, Vite and Tailwind. There is no separate application server. Screens call Supabase directly.

The lockfile resolves newer versions than the minimums in `package.json`, including Supabase JS/Auth **2.116.0**, TypeScript **5.9.3**, and Vite **5.4.21**. The Edge Functions separately import Supabase JS **2.45.0**.

**Actual routes**

| Route | Definition/behavior |
|---|---|
| `/` | Redirect to `/patient/login` |
| `/patient/login` | Patient login and registration mode on the same page |
| `/patient` | Index redirect to `dashboard` |
| `/patient/dashboard` | Patient dashboard |
| `/patient/book` | Booking and query-parameter-driven rescheduling |
| `/patient/appointments` | Active-status appointment list |
| `/patient/history` | Completed/cancelled/no-show list |
| `/patient/profile` | Patient details |
| `/patient/settings` | Appearance and session information |
| `/appointments/login` | Admin login |
| `/appointments` | Index redirect to `dashboard` |
| `/appointments/dashboard` | Daily appointments and monthly calendar |
| `/appointments/booking` | Staff booking, rescheduling and cancellation |
| `/appointments/check-in` | Staff status progression and visit notes |
| `/appointments/patients` | Patient search/create/update |
| `/appointments/doctors` | Doctor creation/activation, schedules and blocked dates |
| `/appointments/reports` | Reports, CSV exports and audit listing |
| `/appointments/settings` | Display name, password, roles and appearance |
| `/queue-board/*` | Redirect to patient login |
| Outer `*` | Redirect to patient login |

There is **no separate registration route** and no dedicated 404 page. Unknown paths inside `/patient/*` or `/appointments/*` have no nested fallback; the outer wildcard does not provide their missing child page.

`vercel.json` defines an SPA rewrite to `index.html`, supporting direct URL refresh on that hosting configuration. Actual hosting behavior was not tested.

The database roles are stored in **`profiles.role`**. Fresh schema values are `admin` and `patient`; the migration also permits deprecated `board`. There is no separate staff table and no doctor login role in the fresh schema.

There are **no frontend Realtime subscriptions**, despite Realtime appearing in the README stack description.

## C. CONFIRMED WORKING FEATURES

These confirmations are limited to the stated evidence. They do not establish successful operation against the hosted database.

| Feature | Evidence | File/Function | Notes |
|---|---|---|---|
| Ordinary slot generation | Executed against synthetic schedules; correct start times and end boundary | [slots.ts](D:/Development/Projects/draft/src/lib/slots.ts:36), `generateSlots` | Assumes valid schedule data |
| Occupied-slot recognition | Synthetic scheduled appointment marks its exact local time occupied | `generateSlots` | Caller must supply correctly scoped appointments |
| Cancelled/no-show release | Executed checks show both statuses stop blocking slots | `generateSlots` | Matches supplied unique-index predicate |
| Unavailable-date exclusion | Synthetic blocked date returns no slots | `generateSlots` | Doctor scoping is the caller’s responsibility |
| Weekday filtering | Synthetic schedule on another weekday produces no slots | `generateSlots` | Sunday is `0`, Saturday is `6` |
| Manila conversion on a Manila-configured runtime | Local slot and day-range checks passed | `generateSlots`, `dayRangeIso` | Does not establish timezone independence |
| Patient-friendly status labels | Checked-in maps to `Confirmed` | [patient.ts](D:/Development/Projects/draft/src/lib/patient.ts:11), `patientStatusLabel` | Also accepts an undefined-in-SQL `confirmed` value |
| Static verification | All **40 static checks passed**; live branch explicitly disabled | [verify.mjs](D:/Development/Projects/draft/scripts/verify.mjs:28) | Checks source patterns, not actual authorization or transactions |
| JavaScript script syntax | `node --check` passed for verification and seeder scripts | `scripts/verify.mjs`, `supabase/seed.cjs` | Seeder was not executed |

No complete authentication, CRUD, booking or notification feature is claimed as operationally confirmed.

## D. PARTIALLY IMPLEMENTED FEATURES

| Feature | Working Part | Missing/Broken Part | Files | Impact |
|---|---|---|---|---|
| Patient authentication | Separate client; password login; registration; profile/patient resolution | Initialization races, ignored errors, incomplete recovery state | `patientAuth.tsx` | Login/profile readiness can become inconsistent |
| Staff authentication | Separate client; explicit login checks `admin` | Restored-session guard accepts any truthy role | `staffAuth.tsx`, `StaffLayout.tsx` | Wrong-role sessions can render staff routes |
| Patient booking | RPC validates doctor, future time, Manila schedule, blocked date and exact conflict | Direct-write fallback; inaccurate occupancy; seconds accepted | `BookAppointment.tsx`, schema | Invalid or misleading booking flow |
| Staff booking | Database insert, slot picker, duplicate-key handling | No authoritative schedule validation or RPC | `Booking.tsx` | Past/off-schedule/blocked bookings can be persisted |
| Rescheduling | Patient RPC checks ownership and target availability; update is atomic | Direct updates bypass rules; stale status race; missing target can become a new booking | Booking pages, schema | Appointment lifecycle inconsistency |
| Cancellation | Status update preserves normal UI history | Direct writes allow invalid transitions; RPC status check races | Appointment pages, schema | Closed visits can be modified |
| Check-in | UI status progression and visit-note insertion | No timestamp assignment, date restriction or backend transition rules | `CheckIn.tsx` | Unreliable attendance history |
| Doctor management | Create/read/activate/deactivate | No name/specialty editing or delete/archive UI | `Doctors.tsx` | Incomplete administration |
| Schedules | Add/remove rows; SQL weekday/range checks | No overlap/duplicate/positive-duration checks | `Doctors.tsx`, schema | Duplicate slots and potentially nonterminating generation |
| Unavailable dates | Doctor-specific add/remove; unique doctor/date | No reconciliation with existing appointments | `Doctors.tsx`, schema | Appointments remain booked on blocked dates |
| Patient management | Search/create/update | No archive/delete workflow; no authenticated linkage workflow for clinic-created patients | `Patients.tsx`, auth | Separate records/history can result |
| Reports | Real appointment queries, calculations and CSV export code | Date grouping, identity grouping, truncation and validation problems | `Reports.tsx` | Incorrect totals or attribution |
| Notifications | Twilio request implementation; provider stubs | CORS failure, false delivery success, no patient confirmation invocation | Edge Functions, staff booking | User-facing notification claims are unreliable |
| Reminders | Function queries tomorrow’s scheduled appointments | Scheduler is commented; timezone, duplicate and retry handling incomplete | `send-reminders`, `cron.sql` | Automation is not established |

## E. BROKEN FEATURES

The reproduction steps below are **logical or isolated local reproductions**. Database mutations described here were not performed during the audit.

**E1 — Patients can promote themselves to administrator**

**Problem:** Profile ownership policies allow changing the authorization role.  
**Severity:** CRITICAL  
**Affected files:** [schema.sql](D:/Development/Projects/draft/supabase/schema.sql:268), `full.sql`, `migrate_patient_booking.sql`  
**Function/component:** `profiles_insert_own`, `profiles_update_own`, `profiles_admin_all`  
**Evidence:** Own insert/update policies constrain `id`, but not `role`; authenticated users receive table privileges.  
**How to reproduce:** In an isolated database, authenticate as a patient and update their own profile’s role to `admin`.  
**Expected:** Ordinary users cannot assign administrative privileges.  
**Actual:** The supplied policy accepts the update; subsequent admin policies authorize that user.  
**Root cause:** Row ownership was treated as sufficient protection for authorization columns.  
**Recommended fix:** Restrict self-service columns and role assignment; use an administrator-only role-management operation.

---

**E2 — Direct appointment writes bypass booking and lifecycle rules**

**Problem:** Patients and administrators can submit appointment changes without RPC validation.  
**Severity:** CRITICAL  
**Affected files:** [schema.sql](D:/Development/Projects/draft/supabase/schema.sql:374), both booking pages, `MyAppointments.tsx`  
**Function/component:** Appointment INSERT/UPDATE policies; direct Supabase writes  
**Evidence:** Patient policies check only `patient_id = my_patient_id()`; admin policy allows all operations. No validation trigger enforces schedule or status transitions.  
**How to reproduce:** Submit an owned appointment with a past/off-schedule timestamp, or update its status directly.  
**Expected:** Every write enforces booking and lifecycle rules.  
**Actual:** The foreign keys, status/source checks and exact unique index are the principal remaining restrictions.  
**Root cause:** Validations exist in optional RPC paths, while direct writes remain authorized.  
**Recommended fix:** Centralize booking/lifecycle operations and close unrestricted write paths.

---

**E3 — Patient availability cannot see other patients’ occupied slots**

**Problem:** The patient slot picker queries appointment rows that RLS intentionally hides.  
**Severity:** HIGH  
**Affected files:** [BookAppointment.tsx](D:/Development/Projects/draft/src/pages/patient/BookAppointment.tsx:140), appointment SELECT policies  
**Function/component:** Booked-slot loading, `generateSlots`  
**Evidence:** Availability selects doctor/date appointments, but patient SELECT permits only owned appointments.  
**How to reproduce:** Patient A books a slot; Patient B opens that doctor/date.  
**Expected:** B sees the slot occupied without learning A’s identity.  
**Actual:** B’s occupancy query cannot return A’s appointment. Booking is rejected later by the RPC/index.  
**Root cause:** Private appointment rows were used as the availability API.  
**Recommended fix:** Add a privacy-preserving availability endpoint returning occupied slots only.

---

**E4 — Seconds and overlapping schedules defeat clinic-slot protection**

**Problem:** Different timestamps within the same intended slot can both pass validation.  
**Severity:** HIGH  
**Affected files:** [schema.sql](D:/Development/Projects/draft/supabase/schema.sql:409), corresponding SQL copies  
**Function/component:** `_assert_slot_bookable`, `uq_doctor_slot`  
**Evidence:** Grid validation uses hour/minute only; conflict checking and uniqueness compare the complete timestamp.  
**How to reproduce:** Submit otherwise-valid appointments at `09:00:00` and `09:00:01` for the same doctor.  
**Expected:** One appointment occupies the intended clinic slot.  
**Actual:** The timestamps differ, and both satisfy the minute-based grid. Overlapping schedule grids can likewise admit overlapping appointments at different starts.  
**Root cause:** No timestamp normalization or interval exclusion.  
**Recommended fix:** Enforce whole-minute grid instants and nonoverlapping schedules; define duration/interval protection if overlapping visits must be prohibited.

---

**E5 — Schedule data can create duplicate slots or freeze generation**

**Problem:** Duplicate/overlapping schedules and nonpositive duration values are accepted by SQL.  
**Severity:** HIGH  
**Affected files:** [schema.sql](D:/Development/Projects/draft/supabase/schema.sql:52), `slots.ts`, `Doctors.tsx`  
**Function/component:** `doctor_schedules`, `generateSlots`  
**Evidence:** SQL checks weekday and `start_time < end_time`, but not duration positivity or overlap. A local check confirmed duplicate rows produce duplicate slot buttons.  
**How to reproduce:** Add duplicate schedule rows; alternatively supply a negative duration through an authorized database write.  
**Expected:** Unique, finite, valid slots.  
**Actual:** Duplicates produce repeated slots. A negative step keeps decreasing the loop counter; zero triggers inconsistent frontend fallback and SQL modulo behavior.  
**Root cause:** Missing database constraints and defensive generation checks.  
**Recommended fix:** Validate positive duration, whole-minute times and overlapping ranges in PostgreSQL and the generator.

---

**E6 — Protected layouts do not enforce their required role**

**Problem:** Restored sessions are admitted without exact portal-role checks.  
**Severity:** HIGH  
**Affected files:** [StaffLayout.tsx](D:/Development/Projects/draft/src/pages/appointments/StaffLayout.tsx:61), [PatientLayout.tsx](D:/Development/Projects/draft/src/pages/patient/PatientLayout.tsx:55), auth providers  
**Function/component:** Layout guards; session initialization  
**Evidence:** Staff guard checks role truthiness; patient guard checks only user/profile presence. Providers do not reject wrong roles during restoration.  
**How to reproduce:** Restore a valid patient session under staff storage, or an admin session under patient storage.  
**Expected:** Wrong-role sessions are rejected consistently.  
**Actual:** The layout condition admits them. The staff condition was confirmed with an isolated local check.  
**Root cause:** Role validation is concentrated in explicit `signIn`, rather than all auth entry paths.  
**Recommended fix:** Enforce exact roles in providers and route guards.

---

**E7 — Auth state can retain stale patient data or resolve inconsistently**

**Problem:** Overlapping initialization/listener/login loads are not coordinated.  
**Severity:** HIGH  
**Affected files:** [patientAuth.tsx](D:/Development/Projects/draft/src/pages/patient/auth/patientAuth.tsx:96), `staffAuth.tsx`  
**Function/component:** `loadAll`, `getSession`, `onAuthStateChange`, `signIn`, `signUp`  
**Evidence:** Both initialization paths load data; later auth events do not reset loading; there is no request-generation guard. `loadAll` does not clear an existing patient when a new user has no profile.  
**How to reproduce:** Delay profile loads while changing session; resolve a new user with no profile after a previous patient was loaded.  
**Expected:** User/profile/patient state belongs to one resolved identity.  
**Actual:** The isolated missing-profile check retained the previous patient state. Other stale-completion races follow from the unguarded async paths.  
**Root cause:** Independently committed state and unchecked async completion order.  
**Recommended fix:** Use one coordinated, cancellable identity-resolution flow and explicit error/recovery states.

---

**E8 — Patient resolution reports success after a failed linkage**

**Problem:** Legacy linking ignores Supabase’s returned update error.  
**Severity:** HIGH  
**Affected files:** [patientAuth.tsx](D:/Development/Projects/draft/src/pages/patient/auth/patientAuth.tsx:39)  
**Function/component:** `resolvePatient`  
**Evidence:** The linkage update is awaited without inspecting `{ error }`, then a fabricated linked object is returned.  
**How to reproduce:** Return an RLS/database error from the legacy linkage update.  
**Expected:** Report linkage failure and retain accurate identity information.  
**Actual:** An isolated check returned `user_id` as attached despite a failed update.  
**Root cause:** Returned PostgREST errors were treated as thrown exceptions.  
**Recommended fix:** Check every result; remove name-based identity attachment and use a verified linkage workflow.

---

**E9 — Rescheduling can become a new booking or falsely report success**

**Problem:** Missing targets and RPC errors trigger incorrect fallback behavior.  
**Severity:** HIGH  
**Affected files:** [BookAppointment.tsx](D:/Development/Projects/draft/src/pages/patient/BookAppointment.tsx:205), [patientRpc.ts](D:/Development/Projects/draft/src/lib/patientRpc.ts:5), `MyAppointments.tsx`  
**Function/component:** `confirmBooking`, `isMissingRpc`  
**Evidence:** Rescheduling requires both `rescheduleId` and loaded `reschedInfo`; otherwise it proceeds to new booking. `isMissingRpc` accepts generic “not found” messages. Updates do not verify affected-row count.  
**How to reproduce:** Use an inaccessible/nonexistent reschedule ID, or return `Appointment not found.` from the RPC.  
**Expected:** Fail rescheduling without creating or claiming a changed appointment.  
**Actual:** A new appointment may be created while the success screen says rescheduled; a zero-row fallback update may be shown as successful.  
**Root cause:** Ambiguous fallback classification and missing target/affected-row validation.  
**Recommended fix:** Fail closed; recognize only actual missing-function errors and require a valid target.

---

**E10 — Rescheduling silently discards edited visit reason**

**Problem:** The reschedule review form accepts a reason that is never saved.  
**Severity:** MEDIUM  
**Affected files:** `BookAppointment.tsx`, `reschedule_appointment` SQL  
**Function/component:** Reschedule review and submission  
**Evidence:** Both RPC and direct-update reschedule payloads omit `reason`.  
**How to reproduce:** Change the reason while rescheduling.  
**Expected:** Save the edit, or make the field read-only.  
**Actual:** Doctor/time changes; reason does not.  
**Root cause:** Shared booking form exceeds the reschedule API’s supported fields.  
**Recommended fix:** Align form and API behavior.

---

**E11 — Staff booking’s appointment lists remain stale after mutations**

**Problem:** Booking/cancellation/rescheduling refreshes slots but not the upcoming list.  
**Severity:** MEDIUM  
**Affected files:** [Booking.tsx](D:/Development/Projects/draft/src/pages/appointments/Booking.tsx:58)  
**Function/component:** Upcoming-load effect, `book`, `reschedule`, `cancel`  
**Evidence:** Upcoming appointments load only on stable `[sb]`; mutation handlers call `loadDay`.  
**How to reproduce:** Book, move or cancel an appointment without leaving the page.  
**Expected:** Upcoming rows and reschedule options immediately reflect the result.  
**Actual:** New rows are absent and cancelled/moved rows retain old information until remount.  
**Root cause:** Separate query states lack coordinated invalidation.  
**Recommended fix:** Reload all affected queries after successful mutations.

---

**E12 — Check-in omits timestamps, accepts future dates and hides pending rows**

**Problem:** Attendance and status handling are incomplete.  
**Severity:** HIGH  
**Affected files:** [CheckIn.tsx](D:/Development/Projects/draft/src/pages/appointments/CheckIn.tsx:79), schema  
**Function/component:** `setStatus`, `GROUP_ORDER`, `forwardOf`  
**Evidence:** Updates contain only `status` and `room`; no trigger fills `checked_in_at`. Date picker allows future dates. `pending` is absent from rendered groups.  
**How to reproduce:** Check in a newly booked appointment; select a future day; create a pending appointment.  
**Expected:** Accurate timestamp, authorized date/status handling, visible pending workflow.  
**Actual:** Timestamp remains null; future check-in is allowed; pending rows disappear from the grouped display.  
**Root cause:** UI-only progression with missing backend attendance rules.  
**Recommended fix:** Add an authorized check-in operation with date/status checks and timestamp assignment.

---

**E13 — Clinic time depends on browser/server timezone**

**Problem:** Frontend and notification time handling disagree with the database’s Manila interpretation.  
**Severity:** HIGH  
**Affected files:** `slots.ts`, appointment pages, dashboards, `Reports.tsx`, Edge Functions, seed files  
**Function/component:** Local `Date` construction, ISO conversions, `isoDay`, notification windows  
**Evidence:** Local execution confirmed an eight-hour difference for the same slot between Manila and UTC runtimes. Reports’ `isoDay` returns yesterday before 08:00 Manila.  
**How to reproduce:** Use a browser configured outside Manila, or run a report preset before 08:00 Manila.  
**Expected:** Identical Philippine clinic dates/times everywhere.  
**Actual:** Submitted/displayed instants and report dates can shift.  
**Root cause:** Browser/runtime timezone is used where clinic timezone is required.  
**Recommended fix:** Explicitly use `Asia/Manila` for clinic calendar conversion and display.

---

**E14 — Reports can group the wrong date or combine different people**

**Problem:** Reports aggregate timestamps and identities incorrectly.  
**Severity:** MEDIUM  
**Affected files:** [Reports.tsx](D:/Development/Projects/draft/src/pages/appointments/Reports.tsx:84)  
**Function/component:** `stats`  
**Evidence:** Day key is `scheduled_time.slice(0, 10)`; doctor identity is name; patient identity is name/contact. Rows are limited without completeness checks.  
**How to reproduce:** Include an early Manila appointment represented on the previous UTC date, or distinct records sharing display identifiers.  
**Expected:** Clinic-date aggregation by immutable IDs, with complete totals.  
**Actual:** Wrong-day counts, combined identities, or silently truncated totals.  
**Root cause:** Presentation fields substitute for dates/identities; no pagination completeness handling.  
**Recommended fix:** Select IDs, group in Manila, and obtain complete server-side aggregates or paginated data.

---

**E15 — Browser confirmations fail CORS**

**Problem:** The confirmation function does not support browser preflight.  
**Severity:** HIGH  
**Affected files:** [send-confirmation/index.ts](D:/Development/Projects/draft/supabase/functions/send-confirmation/index.ts:11), `_shared/notify.ts`  
**Function/component:** Request handler, `json`  
**Evidence:** An isolated OPTIONS request returned 405; responses had no `Access-Control-Allow-Origin`.  
**How to reproduce:** Enable notifications and invoke the function from the browser.  
**Expected:** Successful preflight and readable response.  
**Actual:** The handler rejects preflight and lacks CORS response headers.  
**Root cause:** Missing OPTIONS and CORS handling.  
**Recommended fix:** Implement the documented browser invocation requirements. [Supabase CORS documentation](https://supabase.com/docs/guides/functions/cors)

---

**E16 — Failed notification delivery is reported as success**

**Problem:** Provider failures do not propagate to the confirmation result/UI.  
**Severity:** HIGH  
**Affected files:** `send-confirmation/index.ts`, `_shared/notify.ts`, staff `Booking.tsx`  
**Function/component:** Confirmation return value and frontend result handling  
**Evidence:** A mocked provider HTTP 500 produced function HTTP 200 with `ok: true`, `stubbed: false`, and a failed result. Frontend checks only invocation error and `stubbed`.  
**How to reproduce:** Have Twilio reject the request.  
**Expected:** Delivery failure is recorded and shown accurately.  
**Actual:** The UI can say “Confirmation sent”.  
**Root cause:** Function success is unconditional and delivery outcomes are ignored.  
**Recommended fix:** Separate booking success, provider acceptance and actual delivery status.

---

**E17 — Notification input validation can throw unexpectedly**

**Problem:** Valid JSON that is not an object is not rejected safely.  
**Severity:** MEDIUM  
**Affected files:** `send-confirmation/index.ts`  
**Function/component:** Body validation  
**Evidence:** A mocked authorized request containing JSON `null` threw an uncaught error. UUID validation is also absent.  
**How to reproduce:** Submit `null` as the JSON body.  
**Expected:** A controlled 400 response.  
**Actual:** Accessing `body.appointment_id` throws.  
**Root cause:** Parsing success was treated as structural validation.  
**Recommended fix:** Validate body type and appointment UUID before database access.

---

**E18 — Appointment status checks can race with concurrent changes**

**Problem:** Cancellation/rescheduling read status before updating without locking or an expected-state predicate.  
**Severity:** HIGH  
**Affected files:** [schema.sql](D:/Development/Projects/draft/supabase/schema.sql:525), corresponding SQL copies  
**Function/component:** `reschedule_appointment`, `cancel_appointment`  
**Evidence:** Initial SELECT has no `FOR UPDATE`; final UPDATE filters only by appointment ID.  
**How to reproduce:** Allow staff to complete a visit after the RPC’s status read but before its update.  
**Expected:** The current terminal status prevents cancellation/rescheduling.  
**Actual:** Cancellation can overwrite completion; rescheduling can move a now-terminal visit.  
**Root cause:** Status eligibility and mutation are not serialized.  
**Recommended fix:** Lock the target row, revalidate and use explicit transition predicates.

---

**E19 — Important forms lack consistent validation and submit protection**

**Problem:** Frontend controls and database constraints do not establish complete validation.  
**Severity:** MEDIUM  
**Affected files:** `Doctors.tsx`, `Patients.tsx`, `Profile.tsx`, `Settings.tsx`, booking/login pages, schema  
**Function/component:** Form handlers and table constraints  
**Evidence:** Doctor names can trim to blank; DOB can be future; phone formats and lengths are unrestricted. Several mutation forms have no pending lock. Patient duplicate checks examine only same-name rows and at most five candidates.  
**How to reproduce:** Submit whitespace doctor names, future DOB, malformed contact details, or rapid repeated create requests.  
**Expected:** Consistent server validation and controlled submission.  
**Actual:** Invalid text/date relationships or duplicate records can be accepted.  
**Root cause:** Reliance on basic HTML controls and incomplete client checks.  
**Recommended fix:** Define domain validation in the backend and add appropriate pending/idempotency handling.

---

**E20 — Migration rerun contains a commented-out policy drop**

**Problem:** The advertised rerunnable migration can fail on an existing policy.  
**Severity:** MEDIUM  
**Affected files:** [migrate_patient_booking.sql](D:/Development/Projects/draft/supabase/migrate_patient_booking.sql:198)  
**Function/component:** Patient SELECT policy creation  
**Evidence:** `drop policy ... patient_select_own` appears on the same line as a `--` comment, so it never executes.  
**How to reproduce:** Run the migration against a compatible legacy database already containing that policy.  
**Expected:** Existing policy is replaced safely.  
**Actual:** `CREATE POLICY` encounters the existing policy.  
**Root cause:** SQL statement accidentally commented out; no explicit file-wide transaction.  
**Recommended fix:** Restore the statement and verify upgrades transactionally in an isolated database.

---

**E21 — “This week” doctor availability uses blocked dates from every week**

**Problem:** Weekly leave indicators are calculated from all unavailable dates.  
**Severity:** MEDIUM  
**Affected files:** [Doctors.tsx](D:/Development/Projects/draft/src/pages/appointments/Doctors.tsx:104)  
**Function/component:** `blockedDows`, weekly schedule display  
**Evidence:** Every blocked date contributes its weekday, without current-week filtering.  
**How to reproduce:** Block a Monday several months away.  
**Expected:** Only that date/week is marked unavailable.  
**Actual:** The “Schedule this week” Monday displays Leave.  
**Root cause:** Weekday abstraction discards the actual blocked date.  
**Recommended fix:** Calculate the displayed week’s exact dates.

## F. MISSING REQUIRED FEATURES

The repository provides no separate requirements specification. These are absent capabilities directly relevant to the requested audit, rather than assumed additional product requirements.

| Capability | Finding |
|---|---|
| Enforced authorization-column protection | No mechanism prevents ordinary users assigning themselves `admin` |
| Privacy-preserving full-doctor availability | No endpoint returns occupied slots independently of private appointment rows |
| Consistent staff booking validation | No staff booking RPC or equivalent mandatory database validator |
| Enforced appointment state machine | No backend transition/date/check-in rules |
| Automated reminder installation | No executable scheduler definition or confirmed installed job |
| Notification delivery ledger | No notification table, retry queue, sent marker or idempotency record |
| Frontend Realtime | No subscriptions |
| Doctor detail editing | No name/specialty edit UI |
| Patient archive/delete | No workflow |
| Clinic-record/Auth linking | No verified administrative linkage or claim workflow |
| Automated behavioral/concurrency tests | No runnable suite covering the required security and lifecycle cases |

Email sending, PDF/Excel generation, printing, clinic-wide closure dates and self-service password recovery are also absent as connected features. They should only become required scope if the project’s actual requirements call for them.

## G. SECURITY FINDINGS

**Finding:** Patient-to-admin privilege escalation — E1  
**Severity:** CRITICAL  
**Affected component:** Profiles RLS and every administrator policy  
**Evidence:** Own-row INSERT/UPDATE allows arbitrary valid `role`.  
**Attack/failure scenario:** A patient promotes themselves, then reads or modifies other patients, appointments, clinical notes, doctors and schedules.  
**Recommended remediation:** Protect role writes independently from profile ownership; audit existing role assignments after correcting policies.

**Finding:** Appointment business rules and clinical status are user-writable — E2  
**Severity:** CRITICAL  
**Affected component:** Appointment policies and direct mutation paths  
**Evidence:** Ownership controls rows but not mutable fields or valid transitions.  
**Attack/failure scenario:** A patient self-checks in, marks a visit completed, revives a cancelled appointment, or books an invalid instant.  
**Recommended remediation:** Use authorized lifecycle operations and deny unrestricted clinical-field writes.

**Finding:** Sensitive file is tracked  
**Severity:** HIGH  
**Affected component:** Git repository hygiene  
**Evidence:** `git ls-files .env secret.txt` establishes: `.env` **untracked**, `secret.txt` **tracked**. Its contents were not inspected or displayed.  
**Attack/failure scenario:** Any credentials in that tracked file would travel with the repository. Credential presence and validity remain unverified.  
**Recommended remediation:** Review privately, remove sensitive material from distribution/history as appropriate, and rotate any exposed credentials.

**Finding:** Demonstration account credentials are embedded in setup/seeding material  
**Severity:** HIGH if those accounts exist in a deployed environment  
**Affected component:** `seed.cjs`, setup documentation  
**Evidence:** Seeder defines account credentials and resets existing demonstration-account passwords. Values are withheld.  
**Attack/failure scenario:** A deployment retaining those known demonstration accounts grants unintended access, including administrator access.  
**Recommended remediation:** Separate demonstration provisioning from production; remove or rotate demonstration accounts before deployment.

**Finding:** Security-definer functions are insufficiently hardened  
**Severity:** MEDIUM; exploitation depends on deployed privileges  
**Affected component:** SQL helpers, RPCs and audit trigger  
**Evidence:** Functions use unqualified table names without a fixed `search_path`; scripts do not explicitly revoke default PUBLIC function execution.  
**Attack/failure scenario:** In a permissive SQL environment, object shadowing or excessive helper access can bypass intended boundaries. Ordinary browser exploitation was not established.  
**Recommended remediation:** Qualify objects, pin a safe search path, revoke PUBLIC execution and grant only intended callable functions. [PostgreSQL function security](https://www.postgresql.org/docs/current/sql-createfunction.html)

**Finding:** Notification stubs log identifiable message contents  
**Severity:** HIGH for real patient use  
**Affected component:** `_shared/notify.ts`  
**Evidence:** Logging includes destination, patient-facing message, appointment details and names supplied by callers.  
**Attack/failure scenario:** Patient information is retained in function logs even when no provider is configured.  
**Recommended remediation:** Log minimal delivery metadata; establish appropriate access and retention controls.

**Finding:** CSV formula injection is possible  
**Severity:** MEDIUM  
**Affected component:** `Reports.tsx`, `downloadCsv`  
**Evidence:** Export escapes CSV quotes but does not neutralize formula-leading text; patient names/contact details are editable.  
**Attack/failure scenario:** Exported untrusted values are interpreted as spreadsheet formulas when opened in a spreadsheet application.  
**Recommended remediation:** Adopt a documented spreadsheet-safe export strategy and test the intended spreadsheet applications. CSV quoting alone is insufficient. [OWASP CSV injection guidance](https://community.owasp.org/attacks/CSV_Injection)

**Finding:** Table grants exceed least privilege  
**Severity:** MEDIUM  
**Affected component:** SQL grants  
**Evidence:** `GRANT ALL ... TO authenticated` includes privileges beyond ordinary row CRUD. Whole-table privileges such as TRUNCATE are outside RLS. No browser-accessible SQL/TRUNCATE endpoint was found.  
**Attack/failure scenario:** Future SQL execution surfaces could make the excessive grants dangerous.  
**Recommended remediation:** Grant only required operations and columns. [PostgreSQL row-security documentation](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)

**Environment handling**

| Scope | Variable names found |
|---|---|
| Frontend | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_NOTIFY_ENABLED` |
| Edge Functions | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` |
| Providers | `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Seeder/live verification | Supabase variables plus account-login variables |

No service-role variable is referenced by frontend source. The actual key stored in the frontend’s anon-named variable was deliberately not examined; its privilege level is therefore not certified.

## H. DATABASE AND RLS FINDINGS

The following matrix describes **the supplied fresh-schema SQL**, not confirmed hosted database state. `full.sql` contains an identical core schema.

**A = administrator; P = owning patient. Every administrator permission is undermined by E1 until role assignment is secured.**

| Table | RLS Enabled | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|---|
| `profiles` | Yes | Own row; A all | Own ID; A all | Own ID; A all | A | Own writes improperly include `role` |
| `patients` | Yes | Own `user_id`; A all | Own `user_id`; A all | Own `user_id`; A all | A | No role check on own-row policies |
| `doctors` | Yes | A all; patient sees active doctors | A | A | A | Inactive doctor joins disappear from patient views |
| `doctor_schedules` | Yes | A all; patient sees active-doctor schedules | A | A | A | Missing overlap/duration constraints |
| `doctor_unavailable_dates` | Yes | A all; patient sees active-doctor dates | A | A | A | Doctor-specific only |
| `appointments` | Yes | P own; A all | P own; A all | P own; A all | A | Ownership does not enforce business rules |
| `patient_visit_notes` | Yes | A | A | A | A | Patient fallback note insert is denied |
| `audit_log` | Yes | A | A; definer trigger | No policy | No policy | Appointment insert/update only |
| Separate staff/admin table | Absent | — | — | — | — | Roles are in `profiles` |
| Notification table | Absent | — | — | — | — | No delivery state |

Anonymous table privileges are revoked in the fresh schema.

**No literal `USING (true)` or `WITH CHECK (true)` policy was found.** Nevertheless, the own-profile role write and unrestricted own-appointment field updates are dangerous.

**Patient A versus Patient B**

| Action | Without role escalation | With E1 |
|---|---|---|
| Read B’s patient record | Denied by supplied own-row policy | Allowed as admin |
| Read B’s appointments | Denied | Allowed |
| Update B’s patient record | Denied | Allowed |
| Update/cancel B’s appointment | Denied; patient RPC checks ownership | Allowed through admin direct writes |
| Modify doctors | Denied | Allowed |
| Modify schedules | Denied | Allowed |
| Modify unavailable dates | Denied | Allowed |
| Become admin | **Allowed through own profile write** | Already escalated |

**Constraints and integrity**

| Area | Found | Gap/behavior |
|---|---|---|
| Primary keys | UUID PKs on all eight tables | No missing PK found |
| Auth/profile relationship | Profile ID references `auth.users`, cascading deletion | Auth users can exist without profiles; no provisioning trigger |
| Patient/Auth linkage | `patients.user_id → profiles`, SET NULL on deletion; unique non-null links | Unlinked patients are allowed; clinic-created records are not automatically connected |
| Appointment patient/doctor | Required FKs with DELETE RESTRICT | Orphan referenced records are prevented; even cancelled/history appointments prevent deleting their patient/doctor |
| Appointment time | Required `timestamptz` | No mandatory future/grid/whole-minute constraint |
| Status/source | NOT NULL plus valid-value CHECKs | Valid values can transition arbitrarily |
| Schedule | Required fields, weekday range, start before end | No positive-duration, overlap, duplicate or whole-minute enforcement |
| Unavailable date | Required doctor/date; unique pair | No existing-appointment conflict rule |
| Doctor flags | `is_active` defaults true | Not declared NOT NULL |
| Recurrence | Parent appointment FK, SET NULL on deletion | No same-patient relationship or cycle rule |
| Visit notes | Patient and optional appointment FKs | No rule ensuring note patient matches appointment patient |
| Text fields | Required name/note fields where specified | Empty/whitespace text and excessive length generally permitted |
| Audit | Insert/update appointment trigger | Deletes and other-table changes are not audited |

The upgrade migration relies on the older database’s existing RLS, policies and indexes. It does not establish a complete independently verifiable fresh schema. It also retains `board` and legacy queue columns, contradicting tests expecting all queue columns absent.

`CREATE TABLE/INDEX IF NOT EXISTS` does not validate an existing object’s definition. Therefore, filenames and object names alone cannot establish that the live database has the correct constraints.

## I. AUTHENTICATION FINDINGS

**Every client construction found**

| Instance | File/Purpose | Storage key | Persistence | Auto-refresh | URL/key variables |
|---|---|---|---|---|---|
| Patient singleton | `patientAuth.tsx:9` through factory | `medical-patient` | true | true | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Staff singleton | `staffAuth.tsx:10` through factory | `medical-appointments-staff` | true | true | Same frontend variables |
| Confirmation caller client | `send-confirmation/index.ts:17` | SDK default; not customized | false | SDK default | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| Confirmation service client | Same function, line 38 | SDK default | SDK default | SDK default | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Reminder service client | `send-reminders/index.ts:20` | SDK default | SDK default | SDK default | Service variables |
| Seeder service client | `seed.cjs:55` | SDK default | false | false | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Seeder login-smoke client | `seed.cjs:181` | SDK default | false | SDK default | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| Verification patient client | `verify.mjs:110` | SDK default | false | SDK default | Verification Supabase variables |
| Verification staff client | `verify.mjs:133` | SDK default | false | SDK default | Verification Supabase variables |

The factory’s `createClient` is at [supabaseClient.ts](D:/Development/Projects/draft/src/lib/supabaseClient.ts:10). It sets `detectSessionInUrl: false` for both frontend clients.

All patient data pages use `getPatientClient`; all staff data pages use `getStaffClient`. No cross-portal data-client import was found. Both singleton modules are imported by the application, although their React providers mount by route group.

**Patient implementation**

- `signIn`: password authentication, own profile lookup, optional self-profile insertion, explicit patient-role check, patient resolution.
- `signUp`: Auth signup with `full_name` metadata; when a session exists, inserts profile and resolves patient.
- Without a signup session, returns an email-confirmation message. The UI displays it in the error-message area.
- `signOut`: default Supabase sign-out, followed by local state clearing; returned sign-out errors are ignored.
- `loadProfile`: ignores returned query errors.
- `resolvePatient`: linked-user lookup, legacy name lookup/link attempt, linked insert, then unlinked fallback insert.
- Missing patient records do not prevent provider loading becoming false. Some screens subsequently show indefinite “loading” or cannot save/book.
- Successful form authentication navigates to `/patient/dashboard`; original protected-page destination is not preserved.

**Staff implementation**

- Roles come from `profiles.role`, not Auth metadata.
- Explicit `signIn` requires `admin`.
- Session restoration only loads the profile; runtime cast to `StaffRole` does not validate its value.
- Successful login navigates to `/appointments/dashboard`.
- Missing profile redirects to login; no staff self-provisioning.
- Logout also uses default Supabase scope and ignores returned errors.

Both auth listeners **unsubscribe correctly**. Their data requests have no stale-result/unmount protection. There are duplicate resolution paths, not confirmed permanent duplicate subscriptions.

The locked Auth version is 2.116.0. Supabase’s versioned migration notes describe default lockless coordination starting at 2.107.0. Therefore, the older blanket “async auth callback necessarily deadlocks” diagnosis is **not a confirmed defect for this lockfile**. The application’s races and repeated loads still need correction. [Supabase Auth coordination notes](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/migrations/lockless-coordination.md)

**Explicit patient/staff comparison**

1. **Can a patient session affect the staff portal?**  
   Its storage token is not automatically shared. However, wrong-role restored sessions pass the staff layout, role escalation grants backend staff access, and wrong-portal rejection can revoke that same user’s other sessions.

2. **Can a staff session affect the patient portal?**  
   No automatic token sharing, but a restored admin session is not rejected by the patient layout/provider.

3. **Are separate storage keys intentional and consistent?**  
   **Yes.** The frontend consistently uses the two documented keys.

4. **Are there clients with incompatible auth state?**  
   The two frontend states are deliberately independent, rather than accidental duplicates. Their authorization and initialization handling is insufficient.

5. **Could login to one portal log the user out of the other?**  
   Normal login with two distinct users should not. But entering a user’s credentials into the wrong portal triggers unscoped `signOut()`. Supabase’s default global scope revokes that user’s other refresh sessions, including their correct-portal session. [Supabase sign-out behavior](https://supabase.com/docs/guides/auth/signout)

6. **Could a query use the wrong session?**  
   No automatic cross-client mix-up was found. Wrong-role restoration and stale React identity state can nevertheless pair an unexpected role/user with a page or stale patient identifier. Secured RLS would limit that mismatch; current role escalation defeats that assurance.

**Route scenarios**

| Scenario | Source-level result |
|---|---|
| Anonymous → patient protected route | Loading gate, then patient login |
| Anonymous → staff protected route | Loading gate, then staff login |
| Patient token only in patient key → staff route | Staff has no corresponding session; login |
| Staff token only in staff key → patient route | Patient has no corresponding session; login |
| Wrong-role session restored under target key | Layout admits it if required objects are truthy |
| Direct refresh | Requires SPA host rewrite; configured for Vercel, not runtime-tested |
| Missing profile | Login redirect |
| Missing patient with valid profile | Protected shell can render; patient-dependent features fail/wait |
| Unknown nested route | No nested 404/fallback |
| Redirect loops | No unconditional loop identified; races can cause unexpected return to login |

## J. APPOINTMENT BOOKING FINDINGS

**Patient flow**

`BookAppointment`  
→ `confirmBooking`  
→ `sb.rpc('book_appointment', ...)`  
→ `book_appointment`  
→ `my_patient_id()` and `_assert_slot_bookable()`  
→ appointment INSERT  
→ foreign keys/CHECKs/`uq_doctor_slot`  
→ updated appointment/audit record.

If classified as a missing RPC, the frontend instead directly inserts into `appointments`. It may retry without `reason` and attempt a visit-note insertion, which patient RLS does not allow.

**Staff flow**

`Booking`  
→ `book`  
→ direct `appointments.insert()`  
→ table constraints and audit trigger  
→ separate visit-note INSERT  
→ optional confirmation invocation.

Staff booking does **not** call an RPC.

| Question | Answer |
|---|---|
| Is patient booking correct? | **Partial.** The main RPC validates several important rules, but availability, seconds, fallback, auth readiness and concurrency handling are incomplete |
| Is staff booking correct? | **Partial and insufficiently validated.** Direct insertion bypasses patient RPC rules |
| Is RPC consistently used? | **No** |
| Can business rules be bypassed? | **Yes**, by authorized direct INSERT/UPDATE |
| Can invalid slots be submitted? | **Yes**. Staff direct writes and patient direct API calls allow them; patient RPC also accepts seconds within an otherwise valid minute |
| Does any code directly insert appointments? | **Yes:** staff booking, patient fallback, seeder and live verification branch |
| Are rapid duplicate submissions controlled? | Patient button has busy disabling; staff booking lacks it. Exact unique index prevents identical active timestamps, but not all repeat/conflicting business operations |

**Validation comparison**

| Validation | Patient UI | Patient RPC | Staff UI/direct backend |
|---|---|---|---|
| Doctor chosen | Yes | Exists and active | Selection; FK only at DB |
| Patient identity | Context patient | Derived from authenticated linkage | Selected patient; FK |
| Future timestamp | Today’s past slots filtered | Yes | No mandatory rule |
| Working weekday/grid | Generated slots | Yes, minute-based | Generated slots only |
| Blocked date | Generated slots | Yes | UI only |
| Exact conflict | Incomplete RLS visibility | Explicit check plus unique index | Unique index |
| Visit duration overlap | No | No | No |
| Appointment reason limits | No | Trim only | No |
| Role must be patient | Explicit login only | No explicit role check | Admin policy; vulnerable through E1 |

## K. DOUBLE-BOOKING FINDINGS

The exact database mechanism is:

```sql
create unique index if not exists uq_doctor_slot
  on appointments (doctor_id, scheduled_time)
  where status not in ('cancelled','no_show');
```

Defined at [schema.sql](D:/Development/Projects/draft/supabase/schema.sql:119).

- Table: `appointments`.
- Columns: `doctor_id`, complete `scheduled_time`.
- Partial: **Yes**.
- Status is in the predicate, not the key.
- `completed` remains included.
- `cancelled` and `no_show` release the exact timestamp.
- INSERT and UPDATE receive equal index protection.
- All patient/staff write paths target the same table/index.

**This index guarantees at most one noncancelled/non-no-show appointment for an exact doctor/timestamp, if correctly installed. It does not guarantee one visit per intended clinic slot or prevent overlapping durations.**

| Case | Result under supplied index |
|---|---|
| A. Two patients book exact same doctor/time simultaneously | One can succeed; the other conflicts |
| B. Patient and staff book exact same timestamp | Same protection |
| C. Two staff book exact same timestamp | Same protection |
| D. Cancel then another patient books timestamp | Allowed; cancelled row remains |
| E. Reschedule into occupied timestamp | UPDATE rejected; original row preserved |
| F. Two different appointments reschedule into same timestamp | At most one succeeds |
| Two requests reschedule the same appointment | Can both update serially; last successful target can win |
| Same intended slot with different seconds | Both may succeed |
| Different starts whose durations overlap | Not prevented |

The index was found in source and tested only indirectly through source checks. Its live installation and concurrent database behavior were **not tested**.

## L. AVAILABILITY AND SCHEDULING FINDINGS

Both portals share `generateSlots`; they do not have independent slot-generation algorithms. Their query visibility and additional filtering differ.

| Input | Patient | Staff |
|---|---|---|
| Active doctor | Queries active doctors | Queries active doctors |
| Working schedules | Loads chosen doctor’s rows | Loads chosen doctor’s rows |
| Unavailable dates | Loads chosen doctor’s dates | Loads chosen doctor/selected date |
| Existing appointments | RLS returns own rows only | Admin can read all |
| Cancelled/no-show | Ignored by shared generator | Same |
| Completed | Blocks exact time on queried date | Same |
| Past dates/times | Thirty-day choices; today’s past times filtered | Date picker/past slots remain selectable |
| Timezone | Browser local | Browser local |
| Refresh | Selection-driven queries | Selection-driven queries and `loadDay` |
| Realtime | None | None |

Additional problems:

- Overlapping or duplicate schedules produce repeated slots; no deduplication.
- Negative duration can make generation nonterminating.
- Schedule seconds are ignored by frontend and RPC minute calculations.
- Async query results are not guarded against selection changes. Old doctor/date results can overwrite current state.
- Patient dates can be shown “available” even when all usable slots are occupied or already past.
- Passage of time alone does not recompute memoized past-time filtering.
- Staff can select old slots while a new doctor/date query is pending.
- `generateSlots` trusts callers to filter doctor/date; an isolated check showed a different-date appointment at the same local time blocks a slot if passed in.
- Inactive doctors disappear from patient doctor joins, including retained history appointments.
- Schedule rows have no active/inactive state; they are added or deleted.
- Doctor name/specialty editing and deletion are absent from UI. Deactivation leaves appointments and schedules intact.
- Deleting a doctor through direct admin access is blocked if appointments reference it; otherwise schedule/blocked-date rows cascade.

**October 10 unavailable with existing appointments**

Adding that doctor’s October 10 unavailable row:

1. Creates only a doctor/date block.
2. Does not inspect, cancel, move or warn about existing appointments.
3. Leaves those appointments in their current statuses.
4. Stops later patient RPC booking for that date.
5. Removes slots when the frontend reloads availability.
6. Does not prevent direct staff/API appointment writes.
7. Does not inherently suppress reminders for retained scheduled appointments.

There is no clinic-wide closure table or appointment reconciliation workflow.

Concurrent schedule/unavailability changes are also not serialized with booking validation. A booking can validate before a schedule change and complete afterward.

**Timezone representation**

| Data | PostgreSQL | TypeScript |
|---|---|---|
| Appointment instant | `timestamptz` | ISO string |
| Check-in instant | `timestamptz` | Optional string |
| Schedule times | `time` without timezone | Strings |
| Blocked dates | `date` | Date-key strings |
| DOB | `date` | Optional string |

Database RPCs explicitly interpret clinic time in `Asia/Manila`; frontend helpers generally use browser-local conversion. Edge Functions use runtime-local date boundaries and formatting. Seeder timestamps lack explicit offsets and depend on database timezone. These are inconsistent.

## M. RESCHEDULING AND CANCELLATION FINDINGS

**Rescheduling**

Patient RPC:

- Derives patient identity from Auth.
- Checks appointment ownership.
- Allows only `pending` or `scheduled`.
- Validates active doctor, future target, Manila schedule, blocked date and exact occupancy.
- Updates the same appointment inside the database operation.
- Unique conflict failure preserves the original doctor/time.
- Does not lock the appointment during eligibility checking.
- Does not save edited reason.
- Does not send a notification.

Staff rescheduling directly updates doctor/time without equivalent schedule/status checks.

Patient fallback also directly updates; it trusts RLS ownership and the unique index, not full business validation.

The UI offers rescheduling for checked-in/waiting/in-progress rows, although the patient RPC rejects those statuses.

**Cancellation**

Normal implementation is **`UPDATE status = 'cancelled'`**, not DELETE.

- Patient RPC checks ownership.
- Patient RPC rejects `completed`, `cancelled`, `no_show`.
- It permits cancelling checked-in, waiting and in-progress visits.
- Staff and patient fallback paths do not enforce those terminal-state restrictions.
- Unique-index predicate releases the slot.
- Row and appointment audit history are retained in normal UI use.
- No cancellation notification or delivery-state update exists.
- Admin DELETE is authorized by RLS, although the UI does not use it; deletes are not audited by the appointment trigger.

**Exact statuses and transitions**

All eight statuses below are defined in `src/lib/types.ts`, `schema.sql` and corresponding SQL copies.

| Status | Where Defined | Who Can Set It | Valid Next States |
|---|---|---|---|
| `pending` | Type union and SQL CHECK | Direct admin/own-patient writes | No backend transition rule; omitted from check-in groups |
| `scheduled` | Type union, CHECK/default, booking RPC | RPC and direct writes | UI: checked-in/cancelled/no-show |
| `checked_in` | Type union and CHECK | Staff UI; direct admin/own-patient writes | UI: waiting/cancelled/no-show |
| `waiting` | Type union and CHECK | Staff UI; direct writes | UI: in-progress/cancelled/no-show |
| `in_progress` | Type union and CHECK | Staff UI; direct writes | UI: completed/cancelled/no-show |
| `completed` | Type union and CHECK | Staff UI; direct writes | UI terminal; database still permits other valid statuses |
| `cancelled` | Type union and CHECK | Cancellation paths; direct writes | UI terminal; database still permits other valid statuses |
| `no_show` | Type union and CHECK | Staff UI; direct writes | UI terminal; database still permits other valid statuses |

The CHECK validates membership, not transitions. Therefore cancelled → checked-in, completed → cancelled, completed → moved, and cancelled → completed are possible through direct writes, subject to other constraints.

`confirmed` occurs in patient display/filter code but is **not a SQL or TypeScript appointment status**.

## N. NOTIFICATION FINDINGS

| Function | Purpose/Trigger | Authentication/Authorization | Actual limitations |
|---|---|---|---|
| `send-confirmation` | Staff booking invokes it when `VITE_NOTIFY_ENABLED === 'true'` | Valid user via `getUser`; profile must be `admin` | Missing CORS; minimal input validation; unconditional success; repeat invocation sends again |
| `send-reminders` | Queries tomorrow’s `scheduled` appointments | Matching `x-cron-secret` or exact service-role bearer | Scheduler unestablished; runtime timezone; no deduplication/retry ledger; 1,000-row cap |
| `_shared/notify.ts` | Sends through provider or logs a stub | Called by functions | HTTP success is provider acceptance, not delivery; no persistence, retry or webhook |

**Actual channels**

- **SMS:** Twilio HTTP implementation exists, using `contact_number`. Live configuration/delivery not verified.
- **Email:** Resend helper exists, but both functions pass `to_email: null`. Email is **not connected**.
- **Logging:** Active fallback path when no provider/destination exists. This is not a delivered notification.
- No in-app notification table/UI was found.

Patient booking never invokes confirmation. Rescheduling and cancellation never invoke notification functions.

**Reminders are PARTIAL, not confirmed automated.**

`cron.sql` contains **zero executable SQL lines**. Its scheduling block is commented and contains placeholders.

The template sends only the cron-secret header, while the repository contains no function configuration disabling platform JWT verification or supplying the platform credential. Under default verification, that request can be rejected before the custom-secret handler runs. Actual hosted configuration is unknown. [Supabase function configuration](https://supabase.com/docs/guides/functions/function-configuration)

Other gaps:

- “Approximately 24 hours” actually means the runtime’s entire tomorrow calendar day.
- Runtime timezone is not explicitly Manila.
- Repeated invocations resend the same reminders.
- No retry/backoff or provider timeout policy.
- Sequential provider calls can make larger batches slow.
- Stubbed notifications are counted as successful sends.
- No durable record proves what was sent.
- Cancel/reschedule during a batch can leave already-selected message data stale.
- Automatic delivery requires an installed, authenticated scheduler; the source alone does not establish it. [Supabase scheduling documentation](https://supabase.com/docs/guides/functions/schedule-functions)

## O. UI / CODE QUALITY FINDINGS

**Safe checks executed**

`package.json` provides only `dev`, `build` and `preview`. Build is correctly:

```text
tsc --noEmit && vite build
```

No ESLint configuration, lint script or frontend test runner was found. `tsconfig.json` includes only `src`, so its type check would not validate Deno Edge Functions.

`node_modules/` and `dist/` are absent. No packages were installed, and no build output was written.

| Check | Result |
|---|---|
| TypeScript no-emit check | Could not start: local compiler absent |
| Vite production build with `write:false` | Could not start: Vite absent |
| Static verification with live branch disabled | 40 checks passed |
| Script syntax checks | Passed |
| Shared helper checks | Passed ordinary cases; confirmed duplicate/timezone/fallback defects |
| Auth-function isolated checks | Confirmed false linkage, stale patient retention and truthy-role guard |
| Notification handler isolated checks | Confirmed CORS, false success and null-body defects |
| Live/integration/concurrency tests | Not run |

**Exact build-start errors**

Command:

```text
node node_modules/typescript/bin/tsc --noEmit
```

Exit code `1`:

```text
Error: Cannot find module 'D:\Development\Projects\draft\node_modules\typescript\bin\tsc'
code: 'MODULE_NOT_FOUND'
requireStack: []
Node.js v24.15.0
```

Command:

```text
node --input-type=module -e "import('vite').then(({build}) => build({build:{write:false}}))"
```

Exit code `1`:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from D:\Development\Projects\draft\[eval1]
code: 'ERR_MODULE_NOT_FOUND'
Node.js v24.15.0
```

These are dependency/startup errors. **No successful TypeScript compilation or production build is claimed, and no compiler diagnostics were obtained.**

A documentation-read helper initially encountered this tooling error, then succeeded after explicitly selecting UTF-8 output:

```text
UnicodeEncodeError: 'charmap' codec can't encode character '\u2192' in position 43: character maps to <undefined>
```

In-memory source stripping emitted an experimental Node warning; its assertions passed.

**Visible functionality**

| UI Feature | Visible | Backend Connected | Actually Works |
|---|---:|---:|---|
| Patient registration/login | Yes | Yes | Live behavior not verified; auth defects identified |
| Patient booking | Yes | Yes | Partial |
| Appointment list/history | Yes | Yes | Connected; live behavior unverified; status/time/doctor limitations |
| Staff booking | Yes | Yes | Partial; backend validation incomplete |
| Check-in | Yes | Yes | Partial |
| Patient create/edit | Yes | Yes | Connected; validation/linkage incomplete |
| Doctor add/activate | Yes | Yes | Connected; live behavior unverified |
| Doctor name/specialty edit | No | No UI | Missing |
| Schedule add/remove | Yes | Yes | Partial |
| Block/unblock date | Yes | Yes | Partial |
| CSV exports | Yes | Database-fed frontend export | Implemented; report accuracy/security issues |
| PDF/Excel/print | No dedicated controls | No | Missing |
| “Save User” checkbox | Yes | No | Decorative; persistence stays enabled |
| “Forget password” | Yes | No reset API | Opens a contact-admin hint |
| Notifications setting | Yes | Build flag display only | Not an editable setting |
| “Reminders & Updates” feature label | Yes | Partial function implementation | Automation not verified |
| Room edit | Yes | Saved with status change | No independent room-save operation |
| Visit-note creation | Yes | Yes | Insert connected; no note-reading workflow found |

The frontend contains no hardcoded appointment/patient/report datasets or fake chart values. Reports use Supabase results. Demonstration records are confined to seeding material. `placeholder` occurrences are predominantly legitimate input hints; no frontend TODO/FIXME marker establishes unfinished behavior.

**Other code-quality issues**

- Many queries discard errors and show empty-state messages, confusing outages with no data.
- Schedule removal, unblocking and activation errors are not consistently shown.
- Several UPDATE handlers report success without verifying a row changed.
- Patient profile updates do not refresh the auth context’s display-name profile.
- Form handlers frequently lack `try/finally` for exceptional failures.
- Shared login reset hint refers to staff identification even in patient login.
- README/setup’s Windows semicolon warning is stale: current build script uses `&&`.
- `.env.example` is missing from the current checkout although setup requires it.
- No nested route fallback or application error boundary was found.

**Performance**

| Actual pattern | Finding / justified improvement |
|---|---|
| Doctor schedules filtered by `doctor_id` | No matching schedule index; consider `(doctor_id, day_of_week)` |
| Patient appointments filtered then time-ordered | Existing patient index helps filtering; consider `(patient_id, scheduled_time)` at meaningful volume |
| Audit latest 100 ordered by `created_at` | No corresponding index; consider timestamp index |
| Name/contact substring searches | Existing B-tree indexes do not efficiently serve `%term%` searches; consider trigram indexing if volume justifies it |
| Reports/month calendar fetch rows and aggregate in browser | Limits can silently truncate totals; use complete paginated queries or server aggregates |
| Auth initialization and auth events | Duplicate profile/patient requests and repeated resolution |
| Staff `loadDay` | Reloads schedules/date block/appointments together after mutations |
| Doctor/date filters change quickly | Uncancelled queries can overwrite newer results |
| Joined appointments | Joins avoid an obvious per-row N+1 query |
| Realtime | No subscription-driven refresh storm; no Realtime implementation |
| Existing appointment indexes | Doctor/time, patient, status and time indexes already exist; do not add duplicates blindly |

**Test coverage**

| Area | Existing coverage | Adequacy |
|---|---|---|
| Patient auth | Optional live login smoke check | No behavioral/race/negative suite |
| Staff auth | Optional live login | No restored-role isolation test |
| RLS | Static policy-name checks and manual SQL | No automated adversarial isolation/role test |
| Booking | RPC existence and optional live call | Can skip when chosen timestamp is off-grid |
| Double booking | Index pattern; sequential duplicate writes | No actual concurrent test |
| Rescheduling | Definition/manual instructions | No automated behavior |
| Cancellation | Cleanup/manual instructions | No lifecycle regression test |
| Doctor schedule | Source presence | No validation/overlap tests |
| Unavailable dates | Policy presence/manual checks | No booking-conflict tests |
| Staff booking | Optional live duplicate insert | Mutates database; insufficient validation coverage |
| Check-in | Manual audit example | No timestamp/date/state tests |
| Notifications | Documentation instructions | No existing automated suite |
| Concurrent booking | None | Missing |

The optional live branch of `verify.mjs` **creates/cancels/deletes database rows**. It was explicitly disabled.

Its visit-note isolation assertion incorrectly expects an error. With SELECT privileges and RLS hiding all rows, a successful empty result is the expected denial behavior. The manual queue-object expectation also conflicts with retained migration columns. Passing the static script therefore does not establish security.

## P. PRIORITIZED FIX LIST

### CRITICAL — Fix immediately

1. Prevent self-assignment of `profiles.role`; secure all role changes.
2. Remove unrestricted appointment business/status mutation paths.
3. Establish authoritative booking/rescheduling/status operations for both portals.
4. Privately review tracked sensitive material and deployed demonstration credentials.
5. Verify actual hosted RLS, grants, functions and index definitions before any real-data deployment.

### HIGH — Fix before deployment

1. Add privacy-preserving complete occupancy queries.
2. Enforce whole-minute slot instants, positive duration and nonoverlapping schedules.
3. Correct exact-role guards and coordinated auth initialization.
4. Replace legacy name-based patient linkage and inspect all returned errors.
5. Make reschedule targets/fallbacks fail closed.
6. Serialize appointment status eligibility and updates.
7. Implement check-in date rules and timestamps.
8. Standardize clinic timezone to `Asia/Manila`.
9. Correct confirmation CORS, authorization hardening and delivery reporting.
10. Install/test an authenticated scheduler and durable notification deduplication/retry handling.
11. Define how doctor deactivation, schedule changes and blocked dates reconcile existing visits.

### MEDIUM — Fix before final submission

1. Refresh staff appointment lists after mutations.
2. Resolve pending/confirmed status inconsistencies and invalid action buttons.
3. Fix report date/identity grouping, pagination and CSV safety.
4. Add backend form validation and appropriate pending guards.
5. Correct migration rerun behavior and schema-version differences.
6. Correct weekly availability display.
7. Add doctor detail editing and required patient archive/linkage workflows.
8. Replace silent errors and perpetual loading with recovery states.
9. Add meaningful isolated behavioral/security/concurrency tests.
10. Restore accurate setup documentation and environment template.

### LOW — Improvements/refactoring

1. Separate fetching, mutation and invalidation responsibilities.
2. Add indexes justified by measured query volume.
3. Remove decorative or misleading login controls.
4. Improve note/history presentation and accessibility.
5. Implement Realtime only if required, with explicit scope and cleanup.

## Q. IMPLEMENTATION COMPLETENESS MATRIX

“Working” below reflects evidence available during this audit. Backend protection refers to the supplied SQL; deployed protection remains unverified.

| Module | Implemented | Working | Backend Protected | Main Problem | Status |
|---|---|---|---|---|---|
| Patient Registration | Yes | Not live-verified | No adequate role protection | Profile provisioning/race and role escalation | PARTIAL |
| Patient Login | Yes | Not live-verified | Auth service; unsafe profile roles | Initialization/linkage issues | PARTIAL |
| Patient Profile | Yes | Not live-verified | Own-row policy, undermined by escalation | Validation and stale profile state | PARTIAL |
| Patient Booking | Yes | Partial source/local evidence | Partial | Occupancy visibility, fallback and grid gaps | PARTIAL |
| Patient Appointment List | Yes | Not live-verified | Own-row policy, undermined by escalation | Stale/past status handling | PARTIAL |
| Patient Rescheduling | Yes | Defects confirmed in flow | Partial | Missing target/fallback/status race | PARTIAL |
| Patient Cancellation | Yes | Not live-verified | Partial | Direct state bypass and status race | PARTIAL |
| Patient History | Yes | Not live-verified | Own-row policy, undermined by escalation | 100-row cap, inactive doctor joins | PARTIAL |
| Staff Login | Yes | Not live-verified | Unsafe role foundation | Restored-role guard | PARTIAL |
| Staff Dashboard | Yes | Not live-verified | Admin policy, undermined by escalation | Silent failures/truncated calendar/no refresh | PARTIAL |
| Staff Booking | Yes | Not live-verified | Exact uniqueness and FKs only | No authoritative scheduling validation | PARTIAL |
| Check-in | Yes | Defects confirmed | No state/date enforcement | Missing timestamp; future check-in; hidden pending | BROKEN |
| Appointment Status | Yes | UI progression exists | No transition enforcement | Any valid status can be assigned directly | BROKEN |
| Patient Management | Create/read/update | Not live-verified | Admin policy, undermined by escalation | No linkage/archive; validation gaps | PARTIAL |
| Doctor Management | Create/read/toggle | Not live-verified | Admin policy, undermined by escalation | No detail editing/deletion UI | PARTIAL |
| Doctor Schedules | Add/read/remove | Local defects confirmed | Incomplete constraints | Duplicate/overlap/nonpositive duration | PARTIAL |
| Unavailable Dates | Add/read/remove | Not live-verified | Unique pair; unsafe admin foundation | Existing appointments ignored | PARTIAL |
| Reports | Yes, including CSV | Accuracy defects identified | Admin policy, undermined by escalation | Date/identity grouping and completeness | PARTIAL |
| Staff Settings | Yes | Not live-verified | Unsafe role management | Role escalation; weak mutation state | PARTIAL |
| RLS | Defined | Security defect proven from SQL | **No** | Patient self-promotion | BROKEN |
| RPC | Defined | Not database-executed | Partial | Optional use, seconds and status races | PARTIAL |
| Realtime | No | No | — | No subscriptions | MISSING |
| Notifications | Functions/provider code | Mocked defects confirmed; delivery unverified | Partial | CORS, false success, absent automation/ledger | PARTIAL |

## R. FINAL TECHNICAL ASSESSMENT

1. **Is MedicAppointment ready for a school demonstration?**  
   **Not yet confirmed ready.** Install dependencies in a subsequently authorized implementation phase, obtain a passing build, correct critical defects, and verify the intended demonstration flows against an isolated database.

2. **Are important features currently broken?**  
   **Yes.** Authorization, full patient availability, check-in recording, appointment status enforcement and browser confirmations have confirmed defects.

3. **Is the database protected correctly?**  
   **No, according to the supplied SQL.** Own-row isolation exists, but patient self-promotion defeats administrator boundaries. Hosted configuration was not inspected.

4. **Is double booking genuinely prevented?**  
   **Exact doctor/timestamp duplicates are prevented by the supplied partial unique index, if installed.** Intended-slot and overlapping-duration protection is incomplete. Live concurrency remains unverified.

5. **Are patient and staff authentication safely separated?**  
   **Their storage keys and clients are intentionally separated. Overall safety is incomplete** because restored-role guards, global wrong-portal logout and identity-loading races remain.

6. **Are reminders actually automated?**  
   **Not established.** The scheduler file is entirely commented and no installed cron job was verified.

7. **What must be fixed before calling the project complete?**  
   Authorization, consistent booking/lifecycle validation, accurate availability, auth resolution, check-in, timezone/report correctness, required CRUD gaps, reliable notifications and meaningful tests.

8. **What must be fixed before real deployment?**  
   All critical/high findings, credential/demo-account hygiene, verified hosted RLS and constraints, verified concurrent booking behavior, and authenticated, privacy-conscious notification operations.

**Audit complete. No source changes, migrations, deployment commands or live data mutations were performed.**
