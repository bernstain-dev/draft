-- Phase 1 READ-ONLY catalog verification: no patient records or mutations.
-- Runtime authorization/concurrency tests: node scripts/test-phase1.mjs
-- Review/run these SELECTs manually after applying the migration.

-- Expected: one UNIQUE doctor_id/scheduled_time index excluding cancelled/no_show.
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'appointments' and indexname = 'uq_doctor_slot';

-- Expected: profiles own SELECT/INSERT/UPDATE plus admin SELECT/UPDATE;
-- appointments only patient SELECT and admin SELECT. No mutation policies.
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename in ('profiles','appointments')
order by tablename, policyname;

-- Expected: role INSERT/UPDATE false; full_name UPDATE true;
-- appointment SELECT true, INSERT/UPDATE/DELETE false for browser roles.
select
  has_column_privilege('authenticated','public.profiles','role','INSERT') as can_insert_role,
  has_column_privilege('authenticated','public.profiles','role','UPDATE') as can_update_role,
  has_column_privilege('authenticated','public.profiles','full_name','UPDATE') as can_update_name,
  has_table_privilege('authenticated','public.appointments','SELECT') as can_read_appointments,
  has_table_privilege('authenticated','public.appointments','INSERT') as can_insert_appointments,
  has_table_privilege('authenticated','public.appointments','UPDATE') as can_update_appointments,
  has_table_privilege('authenticated','public.appointments','DELETE') as can_delete_appointments;

-- Expected: definer functions have search_path=""; private helpers/trigger
-- functions deny authenticated EXECUTE; public RPCs allow it.
-- Anonymous EXECUTE must be false for every listed function.
select p.oid::regprocedure as function, p.prosecdef, p.proconfig,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anonymous_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'is_admin','my_patient_id','_require_admin','_require_patient','admin_set_profile_role',
  '_assert_slot_bookable','book_appointment','staff_book_appointment',
  '_reschedule_appointment','reschedule_appointment','staff_reschedule_appointment',
  '_cancel_appointment','cancel_appointment','staff_cancel_appointment',
  'staff_check_in_appointment','staff_set_appointment_status',
  'audit_appointment_changes','set_updated_at')
order by p.proname;

-- Expected: default is patient. This reads configuration, not profile rows.
select column_default from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'role';

-- Phase 2: expected two validated constraints; exclusion uses doctor/day/range.
select conname, convalidated, pg_get_constraintdef(oid)
from pg_constraint where conrelid = 'public.doctor_schedules'::regclass
  and conname in ('phase2_schedule_minutes_check','phase2_schedule_no_overlap');

-- Expected: patient linking is not a generic client UPDATE permission.
select has_column_privilege('authenticated','public.patients','user_id','UPDATE') as can_change_link,
  has_column_privilege('authenticated','public.patients','full_name','UPDATE') as can_change_name;

-- Safe configuration-only function/trigger verification (no records).
select p.oid::regprocedure, p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('_clinic_schedule_slots','get_available_appointment_slots',
  'get_available_appointment_dates','_guard_doctor_calendar_change','staff_block_doctor_date',
  'ensure_patient_identity','admin_link_patient');

-- Existing blocked-day conflicts are retained by the migration, never cancelled.
-- An authorized administrator may privately review these aggregate counts.
select u.doctor_id, u.date, count(*) as conflicting_appointments
from public.doctor_unavailable_dates u join public.appointments a
  on a.doctor_id=u.doctor_id and (a.scheduled_time at time zone 'Asia/Manila')::date=u.date
where a.status not in ('cancelled','no_show') group by u.doctor_id,u.date order by u.date;

-- Global whole-minute appointment constraint and safe legacy-data count.
select conname, convalidated, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.appointments'::regclass and conname='phase2_appointment_minute_check';
select count(*) as invalid_appointment_timestamp_count from public.appointments
where not isfinite(scheduled_time) or extract(second from scheduled_time at time zone 'Asia/Manila')<>0;
