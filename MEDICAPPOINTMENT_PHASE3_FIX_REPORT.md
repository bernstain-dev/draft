# MedicAppointment — Phase 3 Remediation Report

Timestamp: **2026-10-02 23:14 Asia/Manila (UTC+08:00)**.

Workspace: `D:\Development\Projects\draft`.

## Scope and verification boundaries

The original audit, Phase 1 report and Phase 2 report were read before implementation. This phase addresses notifications, reminders, report accuracy, CSV safety, doctor editing, intentional patient linking, validation, loading/error recovery, mutation protection, advertised staff Realtime updates, settings and setup hygiene. Findings refer to the current workspace and the local checks below.

No production deployment, hosted database migration, database reset, real patient query, real provider send, hosted demonstration seeding or destructive Git history rewrite was performed. Application integration tests used disposable loopback PostgreSQL 18 clusters and synthetic identities/records. Provider calls, scheduler transport and Realtime events were mocked. Temporary test clusters were stopped and their verified temporary directories removed. No existing `.env` or `secret.txt` contents were read for this phase; examples contain fake placeholders or variable names only.

The existing audit/Phase 1/Phase 2 reports and standalone Phase 1/Phase 2 migrations were preserved. Their canonical SQL blocks remain byte-identical in fresh/legacy installation files; regression tests verify those copies. Phase 1 role protection, appointment RPC authorization, allowed transitions, exact-slot uniqueness and Phase 2 availability/schedule/identity/timezone protections were retained.

Classification throughout this report:

| Classification | Meaning |
|---|---|
| **CONFIRMED** | Inspected implementation or locally exercised behavior, with evidence identified. This does not imply a deployed service was changed. |
| **PARTIAL** | An implemented workflow has a stated operational or functional limitation. |
| **NOT VERIFIED** | Hosted Supabase, live Auth, real provider delivery, cron extensions/transport, actual browser/spreadsheet or live Realtime behavior was not exercised. |

## 1. Results and requirement coverage

| Phase 3 requirement | Classification | Result / evidence |
|---|---|---|
| 1. Notification CORS | CONFIRMED locally | Exact-origin allowlist, OPTIONS, methods/headers and consistent success/error headers in `_shared/http.ts` and `confirmationHandler`; preflight/denied-origin tests. |
| 2. Delivery result | CONFIRMED locally | Provider rejection is not acceptance; `ok`, `accepted`, `stubbed`, `provider`, `error` and `delivery` have separate meanings. Frontend wording uses those fields. |
| 3. Privacy | CONFIRMED in source/tests | No recipient/message/provider-body debug logging. Ledger stores references and operational metadata, not copied names/contact/reasons. |
| 4. Both booking portals | CONFIRMED locally | Patient and staff approved mutations enqueue transactionally and invoke the same confirmation fast path only after committed RPC success. |
| 5. Reschedule/cancel notices | CONFIRMED locally | Authoritative database trigger creates versioned notices; successful UI handlers request their existing event. No rollback for notification failure. |
| 6. Reminder automation | PARTIAL operationally | Executable Vault/pg_cron/pg_net scheduler definition is in the repository. It was tested against local transport/catalog mocks, not installed on Supabase. |
| 7. Durable ledger | CONFIRMED locally | Two RLS-protected tables, unique event keys, atomic claims/leases, bounded known retries and held ambiguous outcomes. |
| 8. Reminder dates | CONFIRMED locally | Tomorrow and the 07:00 gate explicitly use Asia/Manila; SQL/JavaScript results agree under Manila, UTC and New York timezones. |
| 9. Reports | CONFIRMED locally | Complete SQL aggregates use immutable IDs and inclusive clinic-date filters; >1,500 rows, midnight boundary and audit pagination tested. |
| 10. CSV safety | CONFIRMED locally | Shared encoder neutralizes dangerous text formulas before quoting; Unicode/BOM, quotes and ordinary text preserved. Spreadsheet application behavior remains NOT VERIFIED. |
| 11. Doctor management | CONFIRMED locally | Create/read/name/specialty update/activate/deactivate; backend trigger validation; no browser hard-delete of doctors or patients. |
| 12. Patient management | CONFIRMED locally | Admin exact-Auth-UUID linking UI requires verification/confirmation and reports conflicts. No name-based linking/history merge. Creation has complete server duplicate-review count. |
| 13. Forms | CONFIRMED locally / PARTIAL for hosted Auth policy | Frontend validation plus database triggers/RPC validation; local Auth minimum-password-length config provided. Hosted Auth policy/email flows need staging checks. |
| 14. Error/loading states | CONFIRMED locally | Major reads distinguish loading/empty/failure/retry; shared reads and identity resolution have 30-second deadlines; initial Auth session read is also bounded. |
| 15. Mutation busy states | CONFIRMED locally | Synchronous ref gate prevents same-tick duplicates; pending controls and exception recovery cover appointment/admin/profile/settings/login forms. |
| 16. Status cleanup | CONFIRMED in source/static checks | `confirmed` is removed as an API/database status. Friendly “Confirmed” remains a display label for supported states. |
| 17. Realtime decision | PARTIAL operationally | Advertised staff cross-client updates implemented through one scoped provider subscription and Phase 2 invalidation. Publication installation/live transport NOT VERIFIED. |
| 18. Staff settings | CONFIRMED in source/local protection tests | Name save verifies returned row and reloads identity; password change calls Auth; role changes use existing authorized RPC; self-demotion disabled and backend protection retained. Live password change NOT VERIFIED. |
| 19. Setup/environment | CONFIRMED in source | Fake `.env.example`, corrected installation order, safe runtime variable list and staging instructions. |
| 20. Secret/demo hygiene | PARTIAL | `secret.txt` remains tracked; content not inspected. Ignore rules and local-only seeder guard added, demo prefill removed, private review/rotation/history follow-up documented. |
| 21. Tests | CONFIRMED locally | 19 Phase 3 handler/UI/timezone checks and 15 Phase 3 PostgreSQL checks, plus canonical-copy verification. Required A–Q coverage appears below. |
| 22. Build/regressions | CONFIRMED locally | Build, 69 static checks, all 25 Phase 1 checks, 9 UI + 14 database Phase 2 checks, Phase 3 suite, offline Edge type check and diff whitespace check pass. |
| 23. Migration | CONFIRMED locally | Transactional Phase 3 upgrade after Phases 1/2; fresh/legacy canonical copies; fail-safe validation; no clinical cleanup or historical notification replay. |
| 24. Saved report | CONFIRMED | This complete report records implementation, evidence, limitations and manual staging requirements. No Phase 4 work is authorized by it. |

## 2. Files changed in Phase 3

There were already uncommitted Phase 1/Phase 2 changes. This table lists Phase 3 additions/edits; it does not classify every `git status` entry as new Phase 3 work. `package.json`, `package-lock.json`, Phase 1 tests/migration and standalone Phase 2 migration were not changed in this phase. Installed dependencies were already adequate; no dependency installation was needed.

| File | Change / important functions |
|---|---|
| `supabase/fix_phase3_notifications_reports.sql` | New incremental upgrade: validation, safe own-profile save, duplicate-review count, notification ledger/trigger/worker operations and complete admin report RPCs. |
| `supabase/schema.sql` | Canonical Phase 3 definitions added after Phases 1/2; fresh-install header corrected. |
| `supabase/full.sql` | Same canonical Phase 3 definitions before existing demo portion. Still a local demo convenience file, never an existing-project upgrade. |
| `supabase/migrate_patient_booking.sql` | Same canonical Phase 3 definitions in reviewed legacy path. |
| `supabase/fix_phase3_scheduler.sql` | Separate executable Vault-based worker scheduler; `_invoke_notification_worker`. |
| `supabase/enable_phase3_realtime.sql` | Separate optional appointments-only publication configuration. |
| `supabase/cron.sql` | Removed obsolete plaintext scheduler template; points to executable private configuration. |
| `supabase/config.toml` | Handler-owned authentication configuration; preflight/custom-auth support; local Auth password minimum. |
| `supabase/functions/_shared/http.ts` | `cors`, `json`, `validUuid`, `constantTimeEqual`; exact origins and common response headers. |
| `supabase/functions/_shared/notify.ts` | `normalizePhone`, `sendNotification`, `NotifyResult`; real Twilio acceptance/error boundary, privacy-safe results, timeout, optional callback URL. |
| `supabase/functions/_shared/handlers.ts` | Dependency-injected `confirmationHandler`, `reminderHandler`, `noticeText`; ownership/authentication, payload validation, claim/finish/result dispatch. |
| `supabase/functions/_shared/delivery.ts` | `callbackSignature`, `deliveryHandler`; independently verified Twilio HMAC callbacks and minimal responses. |
| `supabase/functions/send-confirmation/index.ts` | Runtime entry for authenticated browser/server confirmation/reschedule/cancel requests. |
| `supabase/functions/send-reminders/index.ts` | Runtime entry for secret-authenticated durable worker. |
| `supabase/functions/notification-status/index.ts` | New provider delivery callback entry. |
| `supabase/NOTIFICATIONS.md` | Actual channel, acceptance/delivery distinctions, idempotency/retries/holds, scheduler/callback staging guide. |
| `supabase/seed.cjs` | Rejects non-loopback hosted URLs before client creation or writes. No real demonstration seeding was run. |
| `src/lib/notifications.ts` | `notifyAppointment`: truthful messages after committed approved operations; no false “Confirmation sent.” |
| `src/lib/csv.ts` | `csvCell`, `csvText`, `downloadCsv`: spreadsheet formula neutralization, proper quoting, UTF-8 BOM/CRLF. |
| `src/lib/formValidation.ts` | `textError`, `patientFormError`, `doctorFormError`, UUID/date/contact/length validation. |
| `src/lib/useMutation.ts` | Synchronous single-flight gate, pending state, visible exception recovery and unmount guard. |
| `src/lib/useClinicQuery.ts` | Retained Phase 2 request generations; explicit retry/retrying state and 30-second read timeout. |
| `src/lib/asyncState.ts` | `IdentityCoordinator`: bounded identity resolution and cancellation cleanup; stale identities remain unable to commit. |
| `src/lib/usePortalAuth.ts` | Registration field validation, bounded initial session read and retained role/identity/auth-listener safeguards. |
| `src/lib/useAppointmentRealtime.ts` | Single admin-only appointment subscription, 300ms coalescing, role/user/unmount cleanup, existing invalidation. |
| `src/lib/fetchAllRows.ts` | Exact-count pagination that handles lower REST caps and rejects incomplete/error results. |
| `src/lib/patient.ts` | Removed nonexistent `confirmed` status branch; friendly labels remain display-only. |
| `src/components/QueryState.tsx` | Shared Loading/Retrying/error/Retry presentation. |
| `src/components/PatientLink.tsx` | Intentional admin identity-link form, exact UUID, verification checkbox, explicit confirmation, conflicts and pending protection. |
| `src/components/LoginShell.tsx` | Replaced inert Save User checkbox with accurate persistence guidance; password assistance explicitly says contact clinic/verify identity. |
| `src/pages/appointments/auth/staffAuth.tsx` | Provider owns narrow Realtime subscription only for resolved admin identity. |
| `src/pages/appointments/Booking.tsx` | Shared mutation gate, notifications after success, QueryState/retry paths, maintained invalidation, explicit list limits. |
| `src/pages/appointments/CheckIn.tsx` | Protected status/note pending states, query errors, notification on confirmation/cancellation, retained RPC transitions; note limit. |
| `src/pages/appointments/Dashboard.tsx` | Complete monthly server report totals and explicitly paginated clinic-day appointment reads; failure recovery. |
| `src/pages/appointments/Doctors.tsx` | Name/specialty editing, validated row-returning updates, pending create/edit/activation/calendar controls, visible query errors. |
| `src/pages/appointments/Patients.tsx` | Validated pending create/update, stable create UUID, duplicate-review RPC, explicit 50-result label and controlled link panel; success messages retained after refresh. |
| `src/pages/appointments/Reports.tsx` | SQL aggregate RPCs, ID filters/keys, complete totals, Manila dates, shared CSV, paginated/date-filtered audit and explicit errors/empty results. |
| `src/pages/appointments/Settings.tsx` | Name/password/role pending and errors; real identity refresh; admin operational ledger status panel. |
| `src/pages/appointments/StaffLogin.tsx` | Removed demo email prefill; synchronous submission gate and exception recovery. |
| `src/pages/patient/PatientLogin.tsx` | Login/signup single-flight gate; mode changes disabled while pending. |
| `src/pages/patient/Dashboard.tsx` | Explicit doctor/appointment query failure/loading/retry presentation. |
| `src/pages/patient/BookAppointment.tsx` | Pending booking/move, truthful notification results and query recovery; original reason read-only during rescheduling. |
| `src/pages/patient/MyAppointments.tsx` | Pending cancellation/notification and explicit query failure/empty distinction. |
| `src/pages/patient/AppointmentHistory.tsx` | Complete exact-count paginated history and explicit query errors/retries. |
| `src/pages/patient/Profile.tsx` | Atomic `patient_save_profile`, backend/UX validation, pending and identity refresh; used by profile/settings routes. |
| `scripts/verify.mjs` | Existing checks retained, Phase 3 static checks added; 69 total. |
| `scripts/test-phase2-ui.mjs` | Offline client fixture gained channel/removeChannel methods for the new provider subscription; existing assertions retained. |
| `scripts/local-test-db.mjs` | New disposable loopback PostgreSQL harness, synthetic Auth shim, controlled cleanup; no hosted fallback. |
| `scripts/test-phase3-ui.mjs` | Real shared handlers/hooks/components with synthetic clients, independent callback signature checks and mocked providers. |
| `scripts/test-phase3.mjs` | Phase 3 PostgreSQL migrations/security/data-preservation/concurrency/reminder/report/validation/scheduler checks; includes UI suite. |
| `scripts/check-edge.mjs` | Offline TypeScript check of seven Edge files using installed SDK declarations and virtual Deno globals; no emitted files/network. |
| `.env.example` | Restored fake frontend placeholders; server-only variable names as comments. |
| `.gitignore` | Added secret/private-env patterns; `.env.example` remains allowed. Does not remove tracked content/history. |
| `README.md`, `setup.md` | Accurate routes, migration order, safe tests, credential/demo warnings, exact linking model, notification/Realtime staging boundaries. |
| `MEDICAPPOINTMENT_PHASE3_FIX_REPORT.md` | This report. |

Normal ignored build artifacts were generated by Vite. No application deployment, remote migration, commit or history rewrite was performed.

## 3. Database objects, policies and privileges

### 3.1 Incremental migration and data preservation

`supabase/fix_phase3_notifications_reports.sql` is transactional and requires the Phase 2 availability and intentional-link operations. Its preflight locks the affected tables and counts invalid existing profile, doctor, patient, appointment-text, unavailable-reason and visit-note rows. It aborts with counts and a private-review instruction, not patient values. It does not automatically trim/rewrite/delete existing rows or cancel appointments.

Limits must be privately assessed before staging: legacy null/blank names, malformed contacts, future/impossible DOBs, excessive text, whitespace specialties or notes referring to another patient's appointment can stop installation. A local incompatible-doctor fixture proves installation failure rolls back without rewriting the snapshot. Existing valid synthetic profiles, patients, doctors, schedules, appointments, notes, audit history and the exact-slot index identity are preserved across installation and repetition. Separate version rows are backfilled without enqueuing historical confirmations.

The Phase 3 canonical block is identical in the incremental migration, `schema.sql`, `full.sql` and `migrate_patient_booking.sql`. Earlier canonical blocks remain identical to the standalone Phase 1/2 migrations. `uq_doctor_slot` is neither dropped nor weakened.

### 3.2 SQL object inventory

| Object | Purpose / authorization |
|---|---|
| `_valid_clinic_text(text, integer, boolean)` | Private text validation: required trimmed content, maximum length, no control characters for names/addresses/room/device label. |
| `_valid_clinic_contact(text)` | Private nullable contact validator: supported phone punctuation and 7–15 digits. SMS additionally requires normalizable international destination. |
| `_validate_clinic_form()` | Private definer trigger enforcing profile/doctor/patient/text/note validation and note ownership association. |
| `phase3_validate_form` on six tables | BEFORE INSERT/UPDATE on `profiles`, `patients`, `doctors`, `doctor_unavailable_dates`, `appointments`, `patient_visit_notes`. |
| `patient_save_profile(text, date, text, text)` | Authenticated patient only; derives own patient from `_require_patient`; patient demographics and profile display name commit together. No role parameter. |
| `admin_patient_duplicate_count(text, date, text)` | Actual admin only; complete possible-duplicate count by normalized name plus same DOB/contact. A review aid, never an Auth linkage rule. |
| `appointment_notification_versions` | One row per appointment, current positive revision; appointment FK restrict. No historical appointment row modifications. |
| `notification_attempts` | Versioned operational outbox/attempt ledger; appointment and patient references, SMS type/channel/status, provider reference and timestamps. |
| `notification_attempts` unique key | `(appointment_id, notification_type, revision, channel)` prevents duplicate events for the same operation revision. |
| `phase3_notification_provider_reference` | Unique `(provider, provider_reference)` where reference is not null. |
| `phase3_notifications_due` | Ledger index on `(status, retry_at, created_at)` for actual worker due queries. |
| `_enqueue_appointment_notice()` / `phase3_enqueue_notification` | Private AFTER INSERT/UPDATE appointment trigger creates confirmation/reschedule/cancellation outbox events in the same transaction. |
| `request_appointment_notification(uuid, text)` | Authenticated exact admin or owning patient; returns only current existing event UUID for permitted type. Cannot invent a destination or a historical event. |
| `queue_due_appointment_reminders(timestamptz)` | Service-only Manila tomorrow selection and durable reminder enqueue. Optional injected clock supports deterministic local tests. |
| `claim_appointment_notifications(uuid, integer)` | Service-only atomic claim/revalidation with appointment lock, ledger row lock/SKIP LOCKED, lease and attempt counter; max 50, null/invalid batch rejected. |
| `finish_appointment_notification(uuid, uuid, text, text, text, text, boolean)` | Service-only result persistence for matching processing lease; bounded retry only for known failures marked retriable. |
| `notification_result(uuid)` | Service-only minimal status/provider/acceptance/stub/error/delivery view. Browser handler returns this sanitized result after owner/admin authorization. |
| `record_notification_delivery(text, text)` | Service-only matched Twilio-reference delivery update; terminal state cannot be downgraded by delayed callbacks. |
| `staff_appointment_report(date, date, uuid)` | Actual admin only; complete JSON aggregate over inclusive maximum 366 clinic-day range with optional doctor UUID. |
| `staff_report_audit(date, date, text, integer, integer)` | Actual admin only; date/action filters, complete matching total, explicit nonnull offset/limit and at most 100 rows per page. Omits old/new clinical payloads. |
| `_invoke_notification_worker()` | Separate scheduler private definer operation; reads named Vault values at invocation and queues HTTP POST. No browser/service execution grant. |
| `medicappointment-notification-worker` | Separate named five-minute cron job, installed only by deliberate later scheduler configuration. |

All new SECURITY DEFINER functions specify an empty safe `search_path` and qualify application/Auth tables. Function execution privileges are explicitly revoked from PUBLIC/anon/authenticated before only intended entry points are granted. Private validation/trigger functions remain private. Existing Phase 1 administrative role assignment, exact role checks and appointment RPCs remain authoritative.

### 3.3 RLS/ACL changes

| Table/component | SELECT | INSERT/UPDATE/DELETE | Privacy / protection |
|---|---|---|---|
| `appointment_notification_versions` | No browser grant/policy | No browser grants | RLS enabled; only trusted workers/owner operate. |
| `notification_attempts` | Authenticated grant plus `notifications_admin_read` requiring `is_admin()` | No browser grants | RLS enabled; patients see no ledger rows. Service role operates server-side. |
| `doctors` | Existing admin read; replaced `patient_read_doctors` allows active doctors or a doctor referenced by the caller's own appointment | Existing admin create/update retained; browser DELETE revoked | Deactivated doctor names remain visible on an owning patient's history; inactive doctor still cannot be booked. |
| `patients` | Phase 1/2 ownership/admin policies retained | Existing permitted create/update retained with new validation; browser DELETE revoked | No new name-based link; no destructive history deletion. |
| `profiles` | Phase 1 policies retained | Phase 1 column ACLs retained; validation added | Patients/admin browsers still cannot directly write role. Administrative assignment remains `admin_set_profile_role`. |
| `appointments` | Phase 1 ownership/admin policies retained | Direct browser INSERT/UPDATE/DELETE remain forbidden | All sensitive writes remain authorized appointment RPCs; Phase 3 triggers do not bypass them. |
| Report RPCs | Admin role checked in SQL | Read only | No patient report endpoint and no service credentials in frontend. |

No new broad `USING (true)` / `WITH CHECK (true)` clinical policy was introduced. Trusted service-role bypass exists only in the Edge worker; this credential is never passed into frontend code.

## 4. Notification architecture

### 4.1 Transactional events and both portals

The actual flow is:

```text
Patient/staff approved appointment RPC
  -> existing backend authorization/scheduling/transition validation
  -> appointment row mutation
  -> phase3_enqueue_notification (same database transaction)
  -> notification_attempts with current operation revision
  -> RPC commit
  -> optional browser send-confirmation fast path OR durable scheduled worker
  -> atomic claim + authoritative status/time recheck
  -> Twilio mocked/live boundary
  -> leased result persistence
  -> optional signed provider delivery callback
```

Initial scheduled booking creates confirmation. Pending-to-scheduled creates confirmation. A doctor/time change increments notification revision and creates reschedule; cancellation increments revision and creates cancellation. Failed booking/move/status transactions leave no committed notification event.

`Booking.book/reschedule/cancel`, patient `BookAppointment` submit and `MyAppointments.cancelAppointment`, plus relevant `CheckIn` status handlers call the common notification helper after approved mutation success. Both portals retain their separate Supabase clients and session keys. The helper is an optional browser fast path controlled by `VITE_NOTIFY_ENABLED`; server processing of committed outbox events is independent of that frontend flag once the worker is installed.

There is no new clinical insert/update bypass. The browser sends only appointment UUID/type; the backend derives actual owner, destination, status and time. Reschedule reason editing was misleading: the existing reschedule RPC does not change reason. The review now makes the original reason read-only and explains its preservation rather than silently discarding edits.

### 4.2 Browser invocation, CORS and authentication

`confirmationHandler` allows OPTIONS and POST; other methods get 405. `NOTIFY_ALLOWED_ORIGINS` is a comma-separated exact allowlist. Browser origins not listed are denied; an unset allowlist refuses browser origins. No wildcard ACAO or cookie-credential allowance is used. Origin-less server calls still require appropriate authentication.

Allowed-origin responses include `Access-Control-Allow-Origin`, `Access-Control-Allow-Headers` (`authorization, x-client-info, apikey, content-type`), `Access-Control-Allow-Methods` (`POST, OPTIONS`), `Vary: Origin` and no-cache handling, consistently on success and validation/auth/provider-processing failures. OPTIONS is a null-body 204. Denied origins intentionally receive no permission-granting ACAO.

POST requires a Bearer token verified with Supabase Auth `getUser`, followed by the role/ownership SQL operation. Patients may request their own event and admins may request authorized clinic events; another patient's appointment is denied. Invalid JSON, null/array body, missing/invalid UUID/type and excessive body length are rejected before event processing. No caller can supply the SMS destination or message text.

Gateway JWT verification is disabled for these specific function entries so OPTIONS, cron-secret authentication and signed callbacks reach their handlers. Handler authentication is mandatory: real Auth + SQL ownership for confirmation, strong cron secret for worker, provider HMAC for callback. This is consistent with Supabase's documented Edge CORS/preflight model; actual gateway behavior still needs staging verification. [Supabase CORS documentation](https://supabase.com/docs/guides/functions/cors).

### 4.3 Provider result and privacy

SMS via Twilio is the actual supported channel because the current patient destination is `patients.contact_number`. There is no connected email/Resend recipient path; no email delivery claim is made. Philippine mobile formats are normalized to `+63...`; valid international E.164 destinations are also accepted. Invalid destination returns a sanitized failure.

| Event/result | Meaning / frontend behavior |
|---|---|
| Appointment RPC success | Medical appointment/change committed. Notification failure does not undo it. |
| `executed: true` | Edge handler reached event processing/result path. This alone is not a send. |
| `ok: true`, `accepted: true`, `stubbed: false` | Provider returned success with a valid message reference and no failure result. UI says accepted by provider; delivery remains unverified. |
| `stubbed: true` | Provider configuration or destination absent; not sent. No patient message/contact log is produced. |
| `accepted: false`, `error: provider_rejected` | Provider rejected request; UI does not say confirmation sent. |
| `rate_limited` | Known rejection; bounded retry is scheduled. |
| `transport_unknown` / `lease_expired` | Acceptance may have happened; held for private operator/provider reconciliation, no automatic resend. |
| `result_persistence_failed` | Provider outcome could not be durably recorded; delivery/operational result is explicitly uncertain. |
| `delivery: delivered` | Verified provider callback reported delivery. Distinct from API acceptance. |
| `delivery: failed` | Verified callback reported failure; appointment remains saved. |

Twilio non-success responses do not get returned as send success. HTTP 429 is a known retriable rejection; HTTP 5xx, network/timeout/malformed acceptance result are conservative unknowns. Provider requests have a 20-second timeout. Raw provider response/error bodies and credentials are neither logged nor returned.

Messages contain only clinic appointment action, explicit Philippine date/time and a contact-clinic hint. They omit patient/doctor names, medical reason, diagnosis, specialty and room. A provider necessarily receives the destination when sending; app logs and public handler responses do not reproduce it. The ledger stores patient/appointment references, not copied phone/name/message/medical contents or provider secrets.

### 4.4 Delivery callbacks

`notification-status` optionally tracks later delivery. `deliveryHandler` verifies HMAC-SHA1 over the exact configured public callback URL plus all sorted form parameters using the server-only Twilio auth token. It rejects forged/tampered signatures, unexpected method/content/body size, duplicate form parameters, invalid message reference and unsupported status. It returns minimal `{ok}` without patient or provider-secret information. Signature construction follows the provider's published validation rule. [Twilio request-validation documentation](https://www.twilio.com/docs/usage/security).

Only accepted ledger rows with the matching Twilio reference can be updated. Duplicate delivered callbacks preserve the first timestamp; delayed queued/sent callbacks cannot downgrade terminal delivered/failed state. A callback arriving before result persistence returns 503 rather than falsely acknowledging a lost update. Provider retry behavior, exact public URL/proxy configuration and real callback transport are **NOT VERIFIED**.

## 5. Durable delivery ledger and retry limits

`appointment_notification_versions` holds current positive revision separate from appointment history. `notification_attempts` stores UUID, appointment/patient reference, type, SMS channel, revision, scheduled instant, processing/provider/delivery statuses, provider reference, attempts, lease, creation/attempt/acceptance/delivery timestamps, retry time and sanitized error category.

Valid ledger processing statuses are `pending`, `processing`, `accepted`, `failed`, `unknown`, `stubbed`, `superseded`. Delivery states are `not_verified`, `queued`, `sent`, `delivered`, `failed`. Error summaries are bounded categories, not provider body text.

The unique event key prevents duplicate confirmation/reminder enqueue on repeated invocation. Concurrent claims lock the appointment first and then the eligible ledger row, recheck authoritative time/status/version, and use SKIP LOCKED and lease tokens. Two local concurrent claims yield one claimed send. Already accepted events cannot be claimed by UI retries or later worker runs.

Known rate-limit retries use 5 then 10 minute delay, maximum three attempts total. Expired processing leases after five minutes become unknown; network/5xx outcomes remain held. Stubbed/permanent rejection/invalid destination are not automatically replayed. A later configuration change does not silently resend all old stubs. Operators must privately inspect/reconcile unknowns/stubs before any deliberate replay; there is no unsafe general resend button.

Reschedule/cancellation increments revision and supersedes obsolete pending/failed notices. Worker claims verify current status/time/revision. A queued non-cancellation notice requires scheduled status; a cancellation notice requires cancelled status; reminder requires future scheduled time. An already in-flight provider request cannot be unsent by a subsequent change. Exactly-once external SMS delivery across an ambiguous network failure is **not claimed**; the conservative no-blind-retry policy trades automatic recovery for duplicate avoidance.

This is one durable event row with attempt count and latest outcome, not a separate immutable row for every provider request. It meets the requested attempt concepts; detailed provider reconciliation remains a **PARTIAL** operator workflow, not a new automated replay/history-merging feature.

## 6. Reminder architecture and scheduler definition

`queue_due_appointment_reminders` derives tomorrow from `(p_now AT TIME ZONE 'Asia/Manila')::date + 1`, gates enqueue before 07:00 Manila, then uses half-open local-midnight bounds expressed as absolute timestamptz instants. It selects scheduled future appointments and current notification revision only. Repeated passes insert no duplicate reminder key.

For an October 10 09:00 Asia/Manila appointment, the October 9 morning pass selects the October 10 clinic day even if PostgreSQL/Edge runtime is UTC or America/New_York. Rescheduled visits use new authoritative instant/revision; cancelled, completed and no-show appointments are not reminded. Newly created/moved tomorrow appointments after the morning gate are eligible on the next pass.

`reminderHandler` requires exact strong server-only `x-cron-secret`; a patient/admin JWT alone is insufficient. The function queues reminders and drains at most five eligible events of all supported notice types per pass. Five sequential provider timeouts fit within 100 seconds of provider work. Real Edge runtime/database overhead and backlog capacity must be measured in staging. The default SQL claim batch is larger, but this handler deliberately requests five.

`fix_phase3_scheduler.sql` checks Phase 3 capability plus Vault, pg_cron and pg_net interfaces. It requires named Vault entries `medicappointment_url`, `medicappointment_anon_key`, `medicappointment_cron_secret`; no literal credential value is embedded. Its private definer function reads those at invocation and supplies public-key headers plus the independent cron secret. Repeated installation updates the same named five-minute cron job rather than installing duplicates. The scheduler design uses Supabase's documented pg_cron/pg_net/Vault pattern. [Supabase scheduling documentation](https://supabase.com/docs/guides/functions/schedule-functions).

The executable definition is in the repository and local SQL tests use synthetic Vault/cron/net interfaces. **No executable scheduler was installed on a hosted project.** pg_net enqueue success is not proof of HTTP/function/provider success. Monitor cron history, HTTP response status, queue backlog and ledger outcomes privately after deliberate staging installation.

## 7. Report corrections and CSV safety

### 7.1 Complete and correctly grouped reports

`Reports.tsx` invokes `staff_appointment_report`; it does not calculate incomplete report totals from a default-capped browser appointment query. SQL produces one JSON result over the complete matching set. Authorization checks actual admin profile role, not hidden UI controls.

The existing report categories remain total appointments, no-show rate, walk-in share, doctor totals, clinic-day volume, repeat no-show tracking and audit activity. No PDF, Excel, printing or invented report category was added. No-show rate uses all matching appointments as denominator; walk-in share uses the existing `source='walk_in'` count; both display zero safely on an empty range. Repeat no-show display thresholds remain two for flagging and three for the stronger repeat badge.

Doctor grouping and filter use doctor UUID; patient no-show grouping uses patient UUID. Identical names/contacts on different identities do not merge totals. Names are display fields and can change without becoming aggregation keys. Historical doctor/patient names use current table display fields; this is not an immutable historical name snapshot.

Date filtering is inclusive on clinic dates: lower boundary `p_from` midnight Manila; upper boundary next day after `p_to` midnight Manila. Per-day grouping is `(scheduled_time AT TIME ZONE 'Asia/Manila')::date`. Invalid/reversed/nonfinite ranges and ranges beyond 366 days fail explicitly. UI offers retry/reset to a valid range. Date/doctor/filter query keys retain Phase 2 stale-response protection.

Local SQL tests exercise 1,505 appointments beyond REST row caps, separate same-name patient/doctor UUIDs, doctor filtering and patient report denial. A 00:30 Manila appointment on a different UTC date is assigned to its correct clinic day under all three session timezones.

Audit activity uses `staff_report_audit`, with complete matching total, date/action filtering and explicit 100-row pages. The payload includes ID/action/entity/time, not raw old/new medical JSON. A synthetic 105-entry test returns 100 then five distinct rows, with no silent truncation. Audit filtering is independent of doctor report filter, matching the existing category rather than inventing doctor-linked audit semantics.

Staff dashboard month totals use the same complete report RPC. Staff clinic-day appointment lists and patient history use exact-count `fetchAllRows`; this advances by actual returned rows, so a lower server cap is handled. Missing count, query failure or incomplete empty page is an error, not a silently shortened total/history. These paginated lists are not a transactionally frozen multi-request snapshot during concurrent changes; the report RPC is the authoritative aggregate snapshot.

Other deliberately bounded controls are labeled: patient administration first 50 matches, staff upcoming display next 20 with move selector next 50, follow-up selector 20 most recent visits, notification status panel most recent 50 attempts. They are not represented as complete report totals. Other small lookup/upcoming queries still use normal REST limits and have not been generalized into new full-table management features.

### 7.2 Spreadsheet-safe CSV

All report CSV controls use `csv.ts`. Text whose leading whitespace/control prefix is followed by `=`, `+`, `-` or `@`, or whose first character is tab/CR/LF, is prefixed with a single apostrophe before CSV quoting. Every cell is quoted, internal quotes are doubled, lines use CRLF and output has a UTF-8 BOM. Numeric values remain numeric text, including legitimate negative numeric totals; dangerous string values are neutralized.

Tests cover formula-like patient name, doctor name, `+` contact and reason/text input, including leading whitespace/control characters, Unicode and quotes. The current reports do not export appointment reason; its encoder case is protective coverage, not a claim that reason export was added. Consumers may visibly retain the apostrophe. Actual Excel/LibreOffice/browser download behavior is **NOT VERIFIED** and should be checked with the intended spreadsheet software before sharing clinical exports. CSV safety does not authorize distributing patient report data.

## 8. Doctor and patient administration

### 8.1 Doctor operations

`Doctors.tsx` now supports selecting a doctor and editing name/specialty, verifying a returned row on update, plus the existing create/read/activate/deactivate workflow. Stable per-draft UUID controls create retries without intentionally creating a second record. All mutation controls use the synchronous pending gate; backend errors are visible.

Database validation requires a nonblank doctor name of at most 200 characters; specialty is null or nonblank up to 120 characters. Names/specialties reject control characters; inserts/updates normalize surrounding whitespace only for newly written data. Existing valid records are not rewritten by the migration. A doctor with appointments can be deactivated without deleting those appointments. Browser hard-delete is revoked; there is no hard-delete UI.

Phase 2 schedule constraints, whole-minute grid, doctor/date locking and conflict-aware unavailable-date behavior remain. Schedule/unblock errors and pending controls are surfaced. Weekly Leave still compares exact displayed clinic-week dates. Changing schedule or deactivating a doctor does not silently cancel historical/future appointments; deliberate appointment resolution remains an administrator responsibility.

### 8.2 Intentional patient linking and duplicate review

Patients → Link Auth identity displays the selected clinic patient, DOB when available and record UUID. The admin must supply the exact intended Auth UUID, verify identity outside the app, acknowledge verification, and explicitly confirm that no histories will merge. The UI calls the Phase 2 `admin_link_patient(p_patient_id, p_user_id)` using the ordinary authenticated admin client. No service-role credential is requested or exposed.

Invalid UUID, unknown/incorrect identity, conflicting current link or account already owning another patient remains a backend error. The UI requires a real successful response with the expected patient ID before reporting success/calling refresh. Mounted tests prove a conflict never calls the success callback and a rapid double submission sends one RPC.

Legitimate existing `patients.user_id` links and patient-only registration provisioning remain intact. Clinic-created records remain unlinked until intentional verification. Linking before first portal provisioning is preferred; if an account already has its own patient row, the operation refuses rather than deleting/merging histories. Reconciling that situation is a separate reviewed workflow, **PARTIAL**, not an automatic merge implemented here.

Patient create/update validates name, DOB, contact and address, verifies row-returning writes and retains success feedback when refreshing the list. A stable UUID for the draft limits accidental retry duplication. `admin_patient_duplicate_count` performs a complete possible-match count by name plus DOB/contact; the UI requires explicit separate-person confirmation when matches exist. This is only a review warning: names and shared family contact/DOB are not unique identity proof, and genuine namesakes must not be automatically linked or prohibited. Simultaneous intentional creation by different admins is not prevented by a false demographic uniqueness constraint.

Existing requirements do not establish a destructive patient deletion workflow. No delete/archive operation was invented to claim CRUD completeness. Browser patient deletion is revoked and historical records are retained.

## 9. Validation, loading/error handling and mutation UX

| Form/data path | Frontend handling | Authoritative backend protection / limit |
|---|---|---|
| Patient registration | Required trimmed name ≤300, email syntax/length, password minimum, single-flight/mode lock | Auth owns email/password rules; profile/patient provisioning and trigger validation enforce safe role/name/identity. Hosted policy/email verification NOT VERIFIED. |
| Patient profile | DOB/date/contact/length checks, pending, explicit failure, identity refresh | `patient_save_profile` derives own patient and atomically saves patient+profile name with triggers. No role write. |
| Patient administration | Validated create/edit, stable draft UUID, duplicate-review confirmation, visible errors | Existing admin RLS + shared validation trigger. Identity changes go through intentional-link RPC. |
| Doctor create/edit | Required name, valid optional specialty, length limits, pending | Shared doctor trigger and admin RLS; hard-delete revoked. |
| Schedules | Retained Phase 2 validator and readable constraint errors, pending | Phase 2 CHECK/GiST overlap constraints and calendar locking. |
| Unavailable dates | Conflict-aware RPC result, reason length/backend error, pending block/unblock | Phase 2 date/UUID/active-conflict checks and direct-write guard; Phase 3 reason ≤500. |
| Appointment booking | Approved availability/RPC only, bounded reason, pending, actual notification outcome | Phase 1/2 role/ownership/grid/time/status rules; Phase 3 reason ≤2000 and room ≤100. |
| Reschedule/cancel/status | Single-flight, confirmed result, invalidate affected views, notifications for successful relevant operations | Existing locked authorized RPCs/valid transitions/exact-slot constraint remain unchanged. |
| Visit notes | Required trimmed note, maximum 3000, pending and visible error | Trigger rejects blank/oversized note and mismatched patient/appointment; created_by derived from actual caller on authenticated insert. Existing admin RLS retained. |
| Staff settings | Name/password/role forms pending and errors, verified row/RPC result | Profile column ACLs/trigger; role RPC exact admin check and self-demotion denial; actual password Auth service policy must be configured. |
| Notification invocation/config | UUID/type/schema checks; no secret editing form | Auth/ownership, server cron secret, signed callback, bounded sanitized provider results. Secrets configured outside frontend. |

Shared reads use request generations and abort signals retained from Phase 2. `useClinicQuery` now exposes Retry/Retrying and a 30-second deadline; late responses after timeout/filter/identity/unmount cannot replace current state. `IdentityCoordinator` clears prior profile/patient immediately, resolves one identity atomically, times out stalled account queries and cleans up timers/listeners on cancellation. Initial `getSession` also has a deadline and ignores a late initial result after an event or timeout. Mounted tests cover these paths, including transports that ignore abort.

Explicit loading/error/retry/loaded-empty treatment covers patient dashboard, bookings, appointment list, history; staff dashboard, booking, check-in, patients, doctors, reports; settings users/notification state. Empty presentation is gated until the relevant request succeeds. There are no fabricated successful empty results after a known database failure. Protected route auth recovery continues to handle unresolved/missing/wrong portal identity.

`useMutation` uses a ref set synchronously before awaiting, because a React state-only busy flag does not block two calls in one tick. It catches thrown failures, restores pending state and avoids pending updates after unmount. Appointment views continue to invalidate through Phase 2 `appointmentMutationSucceeded`/shared revision. Real staff book/move/cancel mounted regression tests still refresh without remount/reload. Both login forms and patient registration now have the same gate; tests submit actual mounted handlers twice before resolving and observe one operation.

Read deadlines do not promise cancellation of a committed server mutation or complete network abort. Mutation results that are genuinely uncertain must be checked against authoritative records; indiscriminate retry/new UUID issuance is not an exactly-once medical operation guarantee. Backend slot constraints and operation validation remain the final protection.

The nonexistent `confirmed` API status is removed. PostgreSQL/TypeScript statuses remain the existing `pending`, `scheduled`, `checked_in`, `waiting`, `in_progress`, `completed`, `cancelled`, `no_show`; friendly confirmation wording does not become an enum/API value.

The Save User login checkbox had no behavior. It is removed and replaced with truthful session-persistence guidance. Password reset help supplies clinic identity-verification assistance; no automatic password-reset email flow is claimed. This is a **PARTIAL** clinic-assisted recovery workflow.

## 10. Staff settings and Realtime decision

`Settings.saveName` writes only permitted full_name, checks returned row and refreshes real identity state. It no longer relies on a full browser reload. `savePassword` calls Supabase Auth `updateUser`, checks error, validates matching/minimum-length input and clears fields after success; actual hosted password policy/session behavior is **NOT VERIFIED**. `setRole` calls only `admin_set_profile_role`, validates supported roles, checks success and refreshes users. The current admin cannot self-demote via UI; Phase 1 backend also denies it.

The minimal admin notification panel shows type, processing status, delivery status and attempts for the most recent 50 events, with explicit load/error/retry/refresh. It does not display recipients/messages/secrets. Browser notification flag is accurately described as immediate invocation, not a global server-worker enable/disable setting.

Realtime is retained as an intended feature because the project advertises Supabase Realtime/cross-client staff updates. A narrowly scoped `useAppointmentRealtime` subscription belongs to the resolved staff provider, not each page. It subscribes only for actual admin role and user, table `public.appointments`, and coalesces events for 300ms into the existing Phase 2 invalidation bus. Staff dashboard, booking, check-in, reports and other revision consumers then reload relevant queries.

There is no patient global subscription and no new broadcast of patient data. RLS remains authoritative. Patient own successful mutations still update through local invalidation; automatic updates from another client to a patient's own screen are not claimed as implemented. Cleanup removes the channel and pending refresh timer on unmount/role/identity changes; mounted tests show one admin channel, no patient channel, one invalidation for a burst and no delayed refresh after cleanup.

The separate `enable_phase3_realtime.sql` adds only appointments to an existing `supabase_realtime` publication and is safe to review/repeat. It preserves default replica identity rather than enabling full old-row clinical payloads. **Live publication installation, hosted RLS event isolation, reconnect/channel error behavior and two-browser update delivery remain NOT VERIFIED.** Local mutation refresh works independently of Realtime.

## 11. Environment, setup and tracked-secret hygiene

`.env.example` contains only obviously fake public placeholders:

| Frontend variable | Handling |
|---|---|
| `VITE_SUPABASE_URL` | Public endpoint placeholder. |
| `VITE_SUPABASE_ANON_KEY` | Public anon credential placeholder, never service role. |
| `VITE_NOTIFY_ENABLED` | False by default; browser fast path only. |

Server-only variable names are documented without values: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NOTIFY_ALLOWED_ORIGINS`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, optional `NOTIFY_STATUS_CALLBACK_URL`. Supabase runtime variables may be platform-supplied; confirm in staging. No Resend variable is represented as enabling a working email destination.

README/setup now accurately describe actual patient/admin routes, separate `medical-patient` and `medical-appointments-staff` storage, safe tests, Node 24/PostgreSQL requirements, migration order, first-admin trusted bootstrap, exact identity linking and notification/Realtime staging. `/patient/settings` uses `PatientProfile showSettings`, not a separate fictional settings module. Registration is a mode on `/patient/login`, not a new invented route. Production setup does not use `full.sql` or demo seeding.

Build script remains `tsc --noEmit && vite build`; obsolete semicolon workaround and embedded demo login instructions were removed. Fresh setup uses the non-demo `schema.sql`, existing databases use incremental migrations. Private server secrets must never have a `VITE_` prefix or appear in screenshots/logs/source.

`git ls-files --error-unmatch secret.txt` succeeded: **secret.txt is still tracked**. Its contents were not opened, printed or assessed. Ignore rules do not remove tracked files/history. Potential exposure is **NOT VERIFIED**; private review is required, with rotation if credentials/demo passwords were present. Removal from index and coordinated history cleanup are documented follow-up, not destructive actions performed here.

The demo seeder now refuses non-loopback URL hosts before constructing a client. A local test passes a fake hosted URL/fake backend key and verifies refusal without key output or network calls. This guard must not be bypassed with a tunnel. Historical fixed demo accounts may still exist wherever earlier provisioning ran; deployment documentation explicitly requires removing/rotating them. No real accounts were inspected or deleted.

## 12. Safe local test architecture and exact results

Tools used: Node.js **24.15.0**, npm **11**, local PostgreSQL **18**, installed TypeScript/Vite/React test tooling. Tests do not read project `.env` and never fall back to a hosted database. Local PostgreSQL Auth is a minimal synthetic `auth.users`/`auth.uid()` shim; this verifies application SQL authorization, not actual hosted JWT/Auth integration. Provider credentials, phone values, identities and records in tests are synthetic only.

| Command | Final local result |
|---|---|
| `npm run build` | **PASS**, exit 0. `tsc --noEmit` then Vite 5.4.21; 118 modules. Final CSS 40.13 kB / gzip 7.52 kB; JS 521.43 kB / gzip 144.31 kB; index 1.18 kB / gzip 0.62 kB. Vite finished in 5.30s. |
| `node scripts/verify.mjs` | **PASS**, exit 0; all 69 static checks. Static only, not hosted verification. |
| `node scripts/test-phase1.mjs` | **PASS**, exit 0; all 25 checks, including role escalation denial, direct appointment mutation denial, patient/staff booking, concurrent exact-slot protection, rollback/history, status transitions, fresh/legacy SQL and ACL/search paths. |
| `node scripts/test-phase2.mjs` | **PASS**, exit 0; 9 mounted UI/timezone checks + 14 local database checks + canonical SQL equality. Privacy-safe shared slots, invalid seconds/schedules, releases/conflict races, exact identity and stale-state protections retained. |
| `node scripts/test-phase3.mjs` | **PASS**, exit 0; 19 handler/UI/timezone checks + 15 PostgreSQL checks + canonical SQL equality. Provider/scheduler transports mocked. |
| `node scripts/check-edge.mjs` | **PASS**, exit 0; offline TypeScript check of seven Edge files using installed SDK types and virtual Deno declarations. Real Deno/Supabase packaging/runtime remains NOT VERIFIED. |
| `git diff --check` | **PASS**, exit 0; no whitespace errors. Git emits routine LF-to-CRLF working-copy warnings. Untracked new source/report files were separately reviewed. |

Build warning, not a test failure:

```text
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```

No build/type failure remains. Code splitting was not added as unrelated performance work. No ESLint script/config or other test runner was installed merely for this phase; the existing safe scripts plus targeted suites were used.

During development, a fresh-file copy inadvertently converted canonical SQL line endings; equality checks correctly failed with `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal` before running database operations. Canonical blocks were restored byte-for-byte from the standalone migrations and all regressions rerun. An initial added form test used the wrong button label and failed with `TypeError: Cannot read properties of undefined (reading 'props')`; it was corrected to the actual Create account control and passes. Neither was hidden by weakening assertions. Offline Edge compiler-host path handling was corrected for Windows; no application Edge type error remains. Earlier intermediate errors do not represent remaining failures.

A later diagnostic command temporarily overrode Git's normal Windows line-ending conversion (`git -c core.safecrlf=false -c core.autocrlf=false diff --check`) and reported CRLF carriage returns as trailing whitespace, beginning `.gitignore:1: trailing whitespace.` It exited 1; no repository Git setting or source file was changed by that invocation. The required standard `git diff --check` was rerun with the repository's actual configuration and passes, exit 0. The diagnostic override is not the reported verification command.

### 12.1 Required Phase 3 A–Q coverage

| Test | Evidence | Classification / limit |
|---|---|---|
| A. OPTIONS/CORS | Real `confirmationHandler` allowed OPTIONS/success/errors, denied origin and method checks | CONFIRMED locally; actual gateway/browser NOT VERIFIED. |
| B. Malformed confirmation | Invalid JSON, null, array, missing/invalid UUID and invalid type rejected | CONFIRMED locally. |
| C. Unauthorized confirmation | Missing/invalid token, different patient denied; owning patient/admin permitted; real SQL role/ownership tests | CONFIRMED locally; Auth client is synthetic. |
| D. Provider failure | Mock 400/429/5xx/network failure; no acceptance/secret-body exposure; frontend truthful wording | CONFIRMED locally; no live SMS sent. |
| E. Idempotent confirmation | Repeat handler, unique transaction enqueue, concurrent SQL claims and accepted event never reclaimed | CONFIRMED locally. |
| F. Duplicate reminder | Repeated worker/enqueue and durable unique current-revision key | CONFIRMED locally. |
| G. Manila reminder window | Injected morning/tomorrow SQL clock and JavaScript display under Manila/UTC/New York | CONFIRMED locally. |
| H. Cancelled not reminded | Cancel supersedes pending reminder, later enqueue selects none; claim status recheck | CONFIRMED locally. |
| I. Rescheduled new time | Old revision superseded; new claimed notice has exact new instant and reminder revision | CONFIRMED locally. |
| J. Report clinic-date grouping | 00:30 Manila / previous UTC-day fixture + three session timezones | CONFIRMED locally. |
| K. Group by IDs | Same display-name patient/doctor fixtures stay separate; totals 1,505 exceed REST cap | CONFIRMED locally. |
| L. CSV formula injection | Patient/doctor/contact/text malicious-looking strings, prefixes, Unicode and quote escaping | CONFIRMED locally; target spreadsheets NOT VERIFIED. |
| M. Doctor edit validation | Shared form checks plus actual admin SQL update rejection/valid edit/deactivation/history retained | CONFIRMED locally; live browser/admin requests NOT VERIFIED. |
| N. Patient-link conflicts | Actual mounted intentional-link component requires verified exact UUID; backend conflict prevents success; Phase 2 linkage regressions retained | CONFIRMED locally. |
| O. Loading/empty/error | Actual hook/QueryState load → failure → Retry/Retrying → loaded-empty; read/identity/initial-session deadlines | CONFIRMED locally. |
| P. Duplicate submission | Same-tick mutation gate; mounted link and patient signup/login/staff login forms; Phase 2 real staff handlers | CONFIRMED locally. |
| Q. Realtime cleanup/isolation | No patient subscription; single admin channel; burst coalescing and role/unmount timer/channel cleanup | CONFIRMED locally; hosted event RLS/reconnect NOT VERIFIED. |

Additional SQL coverage includes committed vs failed outbox operations, migration preservation/repetition, schema-copy consistency, callback idempotency/terminal protection, bounded/unknown retries, unavailable-date safety retained in regressions, 105-row audit paging, private admin duplicate count, mismatched-note rejection, atomic patient/profile mirroring, fail-safe incompatible data, worker/ledger ACLs and Vault-backed scheduler naming/headers with mocked transport. An independent Node `createHmac` signature test rejects forged/tampered callback requests.

## 13. Preserved Phase 1 and Phase 2 protections

| Protection | Evidence |
|---|---|
| Patient cannot set own role/admin | Original Phase 1 A tests and repeated Phase 3 denied role update; no profile role payload introduced. |
| Permitted profile fields still editable | Phase 1 B regression; atomic patient/profile RPC tests. |
| Direct appointment mutation forbidden | Phase 1 C regression for patient and admin browsers; handlers still approved RPC-only. |
| Backend patient/staff booking/rescheduling | Phase 1 D/E and concurrent booking/rescheduling tests; shared availability validator untouched. |
| Exact-slot unique protection | Existing index identity preserved in Phase 3 migration test; Phase 1 sequential/concurrent tests and Phase 2 whole-minute/grid checks pass. |
| Clinical transitions/check-in/cancellation/history | Phase 1 tests pass unchanged; Phase 3 notices observe committed transitions, not replace them. |
| Private common availability | Phase 2 own/different-patient availability and identical staff-safe payload tests pass. |
| Schedule overlap/duration/date blocking | Phase 2 constraints, invalid-data rollback, direct-write guard and booking/block race pass. |
| Identity linking / no namesake claiming | Phase 2 provisioning/concurrent-first-use tests pass; Phase 3 UI calls the existing exact identity admin RPC. |
| Separate sessions / no stale patient | Same storage keys retained; Phase 2 mounted auth races/wrong-role/local-signout/listener cleanup pass, plus Phase 3 deadlines. |
| Manila dates and exact week | Phase 2 three-timezone date utilities/SQL and unrelated-week Leave regression pass. |
| Mutation view refresh | Phase 2 mounted staff booking/move/cancel visible-list refresh still passes with notification/busy handling. |

No earlier authorization test was removed or relaxed. The Phase 2 offline fixture only gained the minimum channel API needed to mount the current staff provider.

## 14. Remaining issues, risks and NOT VERIFIED items

| Item | Classification | Severity / required action |
|---|---|---|
| `secret.txt` still tracked; historical demo credentials/accounts | PARTIAL / contents and deployment NOT VERIFIED | **HIGH before real deployment**: private review, rotation if exposed, deliberate index/history cleanup and deployed demo-account removal/rotation. Ignore rules alone do not solve it. |
| Actual migration/functions/scheduler/publication not installed | NOT VERIFIED | **HIGH operational prerequisite**: stage reviewed files, verify existing data/privileges/extensions and synthetic end-to-end behavior. Repository code is not deployed behavior. |
| Real SMS acceptance/delivery, provider quota/consent/contact validity | NOT VERIFIED | **HIGH before patient use**: controlled provider staging, consent/privacy/ops configuration and signed callback verification. |
| Ambiguous sends / expired processing / stubs | PARTIAL | **MEDIUM reliability limitation**: conservative holds/no replay require private provider/operator reconciliation; exactly-once external delivery cannot be promised. |
| In-flight notice followed by reschedule/cancel | PARTIAL | **MEDIUM race boundary**: queued events are superseded/revalidated; a provider request already in flight cannot be recalled. |
| Early/out-of-order callback transport and retries | NOT VERIFIED | **MEDIUM**: HMAC/SQL locally verified; early callback returns 503 and actual provider retry behavior must be tested. |
| Worker throughput / extension availability / HTTP timeouts | NOT VERIFIED | **MEDIUM**: five messages per five-minute pass; measure backlog and actual runtime before increasing batch or job frequency. |
| Hosted Auth password/email-confirmation/name-metadata policy | NOT VERIFIED | **HIGH configuration dependency**: enforce real Auth minimum/policy, verify signup/password change/email confirmation; local config does not configure an existing hosted project. |
| Automatic password reset | PARTIAL | **MEDIUM UX/operations**: explicitly clinic-assisted help only. No reset-email workflow invented or claimed. |
| Linking an account that already owns another patient record | PARTIAL | **MEDIUM controlled limitation**: correctly refuses; verified reconciliation/history migration requires a separate authorized design. |
| Simultaneous distinct admin demographic creation | PARTIAL | **MEDIUM data review**: draft UUID prevents accidental retries; review warning does not make name/DOB/contact globally unique or merge histories. |
| Live Realtime isolation/reconnect/two-client behavior | NOT VERIFIED | **MEDIUM**: mounted cleanup/debounce tests pass; staging publication/RLS/transport checks required. Patients have no automatic remote feed. |
| Other bounded normal REST lookups/upcoming queries | PARTIAL | **LOW/volume dependent**: complete report totals/history are fixed; not every management lookup was expanded into new full-table pagination. Explicit intentional limits are described above. |
| Multi-request list pagination while concurrent data changes | PARTIAL | **LOW**: not a transactionally frozen browser list snapshot; server report aggregate avoids that for reporting totals. |
| CSV actual spreadsheet rendering / file downloads | NOT VERIFIED | **MEDIUM before exports used**: test Unicode/formula prefix in intended spreadsheet apps, protect authorized clinical exports. |
| Legacy invalid demographic/text rows | NOT VERIFIED for actual project data | **HIGH migration readiness**: preflight fails safely with counts; privately assess/repair only through an authorized plan, never automatic deletion. |
| Vite >500 kB bundle warning | CONFIRMED | **LOW**: nonblocking build warning; code splitting deferred, no unrelated performance overhaul. |
| Visit-note reading and independent room edit | PARTIAL | **LOW / existing workflow limitation**: notes can be safely created, but a new note-reading/history interface was not added. Room remains saved with an authorized clinical transition, not a separate room-save operation. |
| Dedicated/nested 404 presentation | PARTIAL | **LOW / outside this phase**: existing outer login redirect and absent nested fallback were not redesigned. Report does not claim a new 404 route. |
| Demonstration data generation | NOT VERIFIED | Loopback-only refusal tested; actual local seeder/demo dataset generation was not executed. No hosted demonstration accounts or records were provisioned. |
| Email/Resend, PDF/Excel/print, destructive patient archive/delete | PARTIAL / intentionally outside connected implementation | Not represented as operational or newly required. SMS/CSV/deactivation match the existing model; no fabricated feature claims. |

No claim is made that local tests establish production security, healthcare operational readiness or actual delivery. Real data was intentionally excluded from verification.

## 15. Manual staging and later deployment requirements

These are review instructions, not actions already performed or permission to deploy production.

1. Prepare an isolated staging project and synthetic records/accounts. Privately back up/review existing schema drift, roles, grants, RLS and constraints before an existing-project rollout. Address any preflight failure through a separate authorized data review; do not reset/delete to bypass it.
2. For an existing compatible project, apply reviewed incremental Phase 1 → Phase 2 → `fix_phase3_notifications_reports.sql` in that order. For a genuinely fresh non-demo database, use reviewed `schema.sql`; do not run `full.sql`/demo seeders on hosted services. SQL canonical equality/regression checks support consistency, not arbitrary legacy compatibility.
3. Review local `supabase/config.toml` and stage the three function entries after explicit authorization. Gateway JWT settings allow handler authentication/preflight; preserve real JWT ownership checks, cron-secret checks and provider-signature checks.
4. Configure server-only runtime variables via the secret manager and exact `NOTIFY_ALLOWED_ORIGINS`. Configure no secrets in frontend. Verify hosted Auth password/email policies and the real separate-portal session/role behavior.
5. If using signed delivery tracking, configure the exact public HTTPS `notification-status` URL as `NOTIFY_STATUS_CALLBACK_URL`. Exercise valid/forged callback signatures, public/proxy URL handling, early callback persistence race and terminal/out-of-order updates with synthetic provider traffic.
6. Enable staging Vault, pg_cron and pg_net; securely create `medicappointment_url`, `medicappointment_anon_key`, `medicappointment_cron_secret` without pasting values into SQL/source/output. Review/apply `fix_phase3_scheduler.sql`. Confirm one named job and observe HTTP/function/provider/ledger outcomes, rather than accepting cron enqueue as delivery success.
7. Test Manila morning/tomorrow windows, cancelled/completed/no-show exclusions, rescheduled new times, repeated passes, two simultaneous workers, provider rejection/rate limits, transport unknowns and backlog. Decide operator procedure for held unknown/stubbed attempts before real use; do not blindly resend them.
8. If enabling advertised cross-client staff updates, review/apply `enable_phase3_realtime.sql` and test two synthetic admin clients plus patient isolation. Preserve RLS and default replica identity; verify channel reconnect/failure behavior and no refresh storm. Local mutation invalidation continues regardless.
9. Verify reports with same-name/different-ID synthetic identities, >REST-cap rows, Manila UTC-boundary dates, all date/filter/empty/error states, audit paging and intended spreadsheet CSV imports. Exercise doctor editing/deactivation, conflicting blocked dates, exact identity link refusals and all mutation pending/error paths.
10. Privately resolve tracked-secret/demo hygiene and remove/rotate any deployed demonstration identities before real deployment. History cleanup requires coordinated review; no destructive rewrite is part of this report. No real records should be used in demonstration seeders/tests.
11. Only after staging evidence and a separately authorized rollout should frontend notification fast path, real provider traffic, job/publication configuration and hosted production migration/function deployment be considered. Local build/test success alone is insufficient.

## 16. Final Phase 3 assessment

**CONFIRMED locally:** Phase 3 application/SQL implementation is complete within the stated scope. Build/static/Edge checks pass, all Phase 1 and Phase 2 tests remain passing, and the targeted Phase 3 suite covers required A–Q behaviors with safe synthetic/mocked data. The durable notification workflow distinguishes appointment commit, handler execution, provider acceptance and later signed delivery; reports aggregate complete ID-based Manila-date data; CSV formulas are neutralized; missing doctor editing and intentional-link UX are connected; errors/loading/pending states are explicit; staff Realtime integrates with existing invalidation.

**PARTIAL operationally:** Reminder automation and cross-client Realtime have deployable repository definitions but are not installed; uncertain external sends and conflicting identity histories require deliberate operator reconciliation. Password recovery remains clinic-assisted, and tracked-secret/demo hygiene needs a reviewed private follow-up.

**NOT VERIFIED:** Actual hosted migration compatibility/application, Supabase JWT/Auth policies and gateway behavior, real SMS delivery/callback retry, live scheduler/extensions/HTTP, live Realtime RLS isolation and real-browser/spreadsheet integration. No production deployment was performed and no claim of production readiness is made.

Phase 3 stops here. No Phase 4, production deployment, database reset or real-record cleanup was started.
