-- ============================================================
-- RLS verification tests — run AFTER schema.sql (+ seed.cjs)
-- How to use: create the 2 seed users (admin / patient) via
-- `node supabase/seed.cjs`, then run these SELECTs in the SQL editor
-- using "Run as" -> that user, or from the app with each user's JWT.
--
-- EXPECTED RESULTS are in comments. Any deviation = STOP.
-- ============================================================

-- 0) Sanity: double-booking constraint exists, queue objects are gone
select indexname, indexdef
from pg_indexes
where tablename = 'appointments' and indexname = 'uq_doctor_slot';
-- EXPECTED: 1 row, predicate "WHERE status <> ALL ('{cancelled,no_show}')"

select count(*) as queue_objects_remaining
from (
  select 1 from pg_proc where proname in ('assign_queue_number','get_queue_today','can_access_queue')
  union all
  select 1 from pg_views where viewname = 'queue_today'
  union all
  select 1 from information_schema.columns
  where table_name = 'appointments' and column_name = 'queue_number'
) t;
-- EXPECTED: 0

-- 1) ADMIN: full base-table access
-- Run as admin user:
-- select * from patients limit 1;        -- OK (0+ rows, no error)
-- select * from appointments limit 1;    -- OK
-- select * from doctors limit 1;         -- OK
-- select * from doctor_schedules limit 1;-- OK

-- 2) PATIENT isolation. Run as patient@rhu.com.ph (Maria Santos):
-- select * from patients;
-- EXPECTED: exactly 1 row — Maria Santos (own row via user_id only)

-- select * from appointments;
-- EXPECTED: ONLY Maria Santos' own appointments (…003, …011, …007? no —
-- …007 is Liza's). Own rows only, never another patient's.

-- select * from doctors;
-- EXPECTED: active doctors only (is_active = true).

-- select * from doctor_schedules;
-- EXPECTED: schedules of active doctors only.

-- select * from doctor_unavailable_dates;
-- EXPECTED: blocked dates of active doctors only.

-- select * from patient_visit_notes limit 1;
-- EXPECTED: 0 rows (staff-only table).

-- select * from audit_log limit 1;
-- EXPECTED: 0 rows (admin-read-only).

-- select * from profiles;
-- EXPECTED: exactly 1 row — the patient's own profile (select_own only)

-- 3) DOUBLE-BOOKING rejection (run as admin):
-- Pick a real doctor id + timestamp, then run the same INSERT twice
-- with status='scheduled'. Second INSERT must fail with
-- "duplicate key value violates unique constraint uq_doctor_slot".
--
-- insert into appointments (patient_id, doctor_id, scheduled_time, source, status)
-- values ('<PATIENT_UUID>', '<DOCTOR_UUID>', '2026-10-06T02:00:00+00', 'pre_booked', 'scheduled');
-- -- run identical insert again -> MUST FAIL
--
-- Cancelled slots are reusable (constraint excludes them):
-- update appointments set status='cancelled' where id='<FIRST_ID>';
-- -- identical insert again -> MUST SUCCEED

-- 4) BOOKING RPCs (run as patient@rhu.com.ph):
-- select book_appointment('<ACTIVE_DOCTOR_UUID>', now() + interval '2 days', 'checkup');
-- EXPECTED: {"success": true, ...} ONLY if that instant lands on the
-- doctor's schedule grid — otherwise a friendly exception
-- ("...not available...", "already been booked...").
--
-- Double-book guard: call book_appointment twice for the same slot.
-- Second call MUST raise 'already been booked'.
--
-- Ownership: reschedule/cancel of ANOTHER patient's id MUST raise
-- 'Appointment not found.'
-- select reschedule_appointment('<OWN_ID>', '<DOCTOR_UUID>', now() + interval '3 days');
-- select cancel_appointment('<OWN_ID>');

-- 5) AUDIT trigger check (run as admin):
-- update appointments set status='checked_in' where id='<ID>' and status='scheduled';
-- select action, entity, old_value->>'status', new_value->>'status', created_at
-- from audit_log where entity_id='<ID>' order by created_at desc limit 5;
-- EXPECTED: rows with action='status_change' (or 'cancel'/'reschedule' as
-- appropriate). As patient, SELECT on audit_log returns 0 rows
-- (admin-only read) — that is correct.
