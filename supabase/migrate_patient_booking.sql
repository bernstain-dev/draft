-- ============================================================
-- MedicalAppointment — patient booking migration (queue removal).
-- Run ONLY on databases created with the OLD (pre-cleanup) schema.
-- Fresh installs: supabase/schema.sql already includes everything
-- below — do NOT run this file (it aborts with an error if it
-- detects the clean schema, as a safety net).
-- Every statement is idempotent (IF NOT EXISTS / DROP IF EXISTS),
-- so re-running on an old database is safe.
-- ============================================================

-- Safety net: abort on fresh (post-cleanup) databases.
do $$
declare
  v_def text;
  v_has_queue_col boolean;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint where conname = 'profiles_role_check';
  select exists (
    select 1 from information_schema.columns
    where table_name = 'appointments' and column_name = 'queue_number'
  ) into v_has_queue_col;
  if v_def like '%patient%' and not v_has_queue_col then
    raise exception 'Fresh (post-cleanup) schema detected — this migration is only for pre-cleanup databases. Aborting with no changes.';
  end if;
end $$;
-- What this does:
--  1) Narrows roles to admin + patient: legacy 'receptionist'/'doctor'
--     rows are remapped to 'admin' (their logins keep working);
--     'board' rows are kept readable so no existing data breaks
--     (deprecated, no queue access after section 4).
--  2) Links patients -> auth via patients.user_id.
--  3) Adds appointments.reason + 'pending' status.
--  4) REMOVES the Board Queuing system: assign_queue_number trigger/
--     function, queue_today view, get_queue_today() and
--     can_access_queue(). queue_number data is KEPT (no data loss)
--     but nothing assigns or reads it anymore.
--  5) Patient RLS: patients read doctors/schedules/unavailable dates
--     and manage ONLY their own patient row + appointments.
--  6) Backend booking validation RPCs used by the patient portal:
--     book_appointment / reschedule_appointment / cancel_appointment.
--     The authenticated patient is derived from auth.uid() — a
--     frontend-supplied patient id is never trusted.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Roles become admin + patient. Legacy staff roles are remapped
--    to admin first so existing staff logins keep working.
--    ('board' kept for old rows, deprecated — no new board accounts,
--    no queue access).
-- ------------------------------------------------------------
update profiles set role = 'admin' where role in ('receptionist','doctor');

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check
  check (role in ('admin','patient','board'));

comment on column profiles.role is
  'Logins are admin + patient only. Deprecated value: board (queue kiosk removed; rows retained for history).';

-- Staff (now admin-only) base-table policies: replace the old
-- receptionist/doctor/admin versions.
drop policy if exists "staff_all_doctors" on doctors;
drop policy if exists "staff_all_schedules" on doctor_schedules;
drop policy if exists "staff_all_unavailable" on doctor_unavailable_dates;
drop policy if exists "staff_all_patients" on patients;
drop policy if exists "staff_all_notes" on patient_visit_notes;
drop policy if exists "staff_all_appointments" on appointments;
drop policy if exists "audit_staff_insert" on audit_log;

create policy "staff_all_doctors" on doctors
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  );

create policy "staff_all_schedules" on doctor_schedules
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  );

create policy "staff_all_unavailable" on doctor_unavailable_dates
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  );

create policy "staff_all_patients" on patients
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  );

create policy "staff_all_notes" on patient_visit_notes
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  );

create policy "staff_all_appointments" on appointments
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  );

create policy "audit_staff_insert" on audit_log
  for insert with check (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  );

-- ------------------------------------------------------------
-- 2) patients.user_id -> auth link
-- ------------------------------------------------------------
alter table patients
  add column if not exists user_id uuid references profiles(id) on delete set null;

create unique index if not exists uq_patients_user on patients (user_id);

-- ------------------------------------------------------------
-- 3) appointments.reason + 'pending' status
-- ------------------------------------------------------------
alter table appointments
  add column if not exists reason text;

-- Rebuild the status check to include 'pending' (patient-side "Pending").
-- Internal staff statuses (checked_in/waiting/in_progress) are retained
-- for the staff check-in workflow but are NEVER shown in the patient
-- portal (mapped to "Confirmed" there).
alter table appointments drop constraint if exists appointments_status_check;
alter table appointments
  add constraint appointments_status_check
  check (status in (
    'pending','scheduled','checked_in','waiting','in_progress',
    'completed','cancelled','no_show'
  ));

-- ------------------------------------------------------------
-- 4) REMOVE the Board Queuing system (no replacement)
-- ------------------------------------------------------------
drop trigger if exists trg_assign_queue_number on appointments;
drop function if exists assign_queue_number();
drop view if exists queue_today;
drop function if exists get_queue_today();
drop function if exists can_access_queue();

-- queue_number data is preserved; the column is now inert.
comment on column appointments.queue_number is
  'DEPRECATED: Board Queuing removed. Retained for historical data only — nothing assigns or displays it.';
comment on column appointments.is_priority is
  'Staff triage flag. Not part of the patient portal.';

-- ------------------------------------------------------------
-- 5) Patient identity helper (SECURITY DEFINER so RLS on
--    `patients` itself can never recurse through it)
-- ------------------------------------------------------------
create or replace function my_patient_id()
returns uuid as $$
  select p.id from patients p where p.user_id = auth.uid() limit 1;
$$ language sql security definer stable;

-- ------------------------------------------------------------
-- 6) Patient RLS policies
--    (existing staff policies are untouched)
-- ------------------------------------------------------------

-- Patients may read ACTIVE doctors (needed for "Choose a Doctor").
drop policy if exists "patient_read_doctors" on doctors;
create policy "patient_read_doctors" on doctors
  for select using (
    is_active = true
    and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'patient')
  );

-- Patients may read schedules / blocked dates of active doctors
-- (needed for "Choose a Date" / "Choose an Available Time").
drop policy if exists "patient_read_schedules" on doctor_schedules;
create policy "patient_read_schedules" on doctor_schedules
  for select using (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'patient')
    and exists (select 1 from doctors d where d.id = doctor_schedules.doctor_id and d.is_active = true)
  );

drop policy if exists "patient_read_unavailable" on doctor_unavailable_dates;
create policy "patient_read_unavailable" on doctor_unavailable_dates
  for select using (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'patient')
    and exists (select 1 from doctors d where d.id = doctor_unavailable_dates.doctor_id and d.is_active = true)
  );

-- Patients own exactly one row in `patients` (via user_id).drop policy if exists "patient_select_own" on patients;
create policy "patient_select_own" on patients
  for select using (user_id = auth.uid());

drop policy if exists "patient_insert_own" on patients;
create policy "patient_insert_own" on patients
  for insert with check (user_id = auth.uid());

drop policy if exists "patient_update_own" on patients;
create policy "patient_update_own" on patients
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Let every user keep their own display name in sync
-- (patient portal updates profiles.full_name on profile save).
drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Appointments: patients see and manage ONLY their own rows.
-- The row is always saved under the authenticated patient
-- (my_patient_id()), never a frontend-supplied id.
drop policy if exists "patient_select_own_appointments" on appointments;
create policy "patient_select_own_appointments" on appointments
  for select using (patient_id = my_patient_id());

drop policy if exists "patient_insert_own_appointments" on appointments;
create policy "patient_insert_own_appointments" on appointments
  for insert with check (patient_id = my_patient_id());

drop policy if exists "patient_update_own_appointments" on appointments;
create policy "patient_update_own_appointments" on appointments
  for update using (patient_id = my_patient_id())
  with check (patient_id = my_patient_id());

-- ------------------------------------------------------------
-- 7) Booking validation RPCs (backend enforcement — the
--    frontend ALSO validates, but the backend never trusts it)
--
-- Timezone note: doctor_schedules store LOCAL wall-clock times for the
-- clinic (Asia/Manila). Slot validation therefore interprets the
-- requested instant in Asia/Manila, matching the patient portal which
-- builds slots from the same schedules.
-- ------------------------------------------------------------

-- Shared slot check: doctor exists+active, date valid, doctor open that
-- day, slot fits the schedule grid, slot not already booked.
create or replace function _assert_slot_bookable(p_doctor_id uuid, p_scheduled_time timestamptz)
returns void as $$
declare
  v_local timestamp;
  v_date date;
  v_dow int;
  v_min int;
  v_ok boolean;
begin
  -- 1. doctor exists and is active
  if not exists (select 1 from doctors d where d.id = p_doctor_id and d.is_active = true) then
    raise exception 'This doctor is not available for appointments. Please choose another doctor.';
  end if;

  -- 2. date/time must be in the future
  if p_scheduled_time <= now() then
    raise exception 'Please choose a future date and time for your appointment.';
  end if;

  v_local := p_scheduled_time at time zone 'Asia/Manila';
  v_date := (v_local)::date;
  v_dow := extract(dow from v_local)::int;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;

  -- 3. doctor must not be blocked that date
  if exists (select 1 from doctor_unavailable_dates u where u.doctor_id = p_doctor_id and u.date = v_date) then
    raise exception 'This doctor is not available for appointments on the selected date. Please choose another date.';
  end if;

  -- 4. slot must sit on the doctor's schedule grid for that weekday
  select exists (
    select 1 from doctor_schedules s
    where s.doctor_id = p_doctor_id
      and s.day_of_week = v_dow
      and v_min >= (extract(hour from s.start_time)::int * 60 + extract(minute from s.start_time)::int)
      and v_min + s.slot_duration_minutes <= (extract(hour from s.end_time)::int * 60 + extract(minute from s.end_time)::int)
      and mod(
        v_min - (extract(hour from s.start_time)::int * 60 + extract(minute from s.start_time)::int),
        s.slot_duration_minutes
      ) = 0
  ) into v_ok;
  if not coalesce(v_ok, false) then
    raise exception 'This appointment time is no longer available. Please choose another time.';
  end if;

  -- 5+6. slot must not already be booked (unique index uq_doctor_slot
  -- backs this; the explicit check yields the friendly message).
  if exists (
    select 1 from appointments a
    where a.doctor_id = p_doctor_id
      and a.scheduled_time = p_scheduled_time
      and a.status not in ('cancelled','no_show')
  ) then
    raise exception 'This appointment slot has already been booked. Please select another available time.';
  end if;
end;
$$ language plpgsql security definer;

-- POST /appointments equivalent: book under the authenticated patient.
create or replace function book_appointment(
  p_doctor_id uuid,
  p_scheduled_time timestamptz,
  p_reason text default null
)
returns jsonb as $$
declare
  v_patient uuid;
  v_id uuid;
begin
  -- 7. appointment saved under the logged-in patient (never frontend input)
  if auth.uid() is null then
    raise exception 'You must be signed in to book an appointment.';
  end if;
  v_patient := my_patient_id();
  if v_patient is null then
    raise exception 'We couldn''t find your patient profile. Please complete your profile and try again.';
  end if;

  perform _assert_slot_bookable(p_doctor_id, p_scheduled_time);

  begin
    insert into appointments (patient_id, doctor_id, scheduled_time, source, status, reason, created_by)
    values (v_patient, p_doctor_id, p_scheduled_time, 'pre_booked', 'scheduled', nullif(trim(coalesce(p_reason, '')), ''), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This appointment slot has already been booked. Please select another available time.';
  end;

  return jsonb_build_object(
    'success', true,
    'id', v_id,
    'message', 'Your appointment has been booked successfully.'
  );
end;
$$ language plpgsql security definer;

-- Reschedule an OWN appointment to a new validated slot.
create or replace function reschedule_appointment(
  p_appointment_id uuid,
  p_doctor_id uuid,
  p_scheduled_time timestamptz
)
returns jsonb as $$
declare
  v_patient uuid;
  v_owner uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to reschedule an appointment.';
  end if;
  v_patient := my_patient_id();
  if v_patient is null then
    raise exception 'We couldn''t find your patient profile. Please complete your profile and try again.';
  end if;

  select patient_id, status into v_owner, v_status
  from appointments where id = p_appointment_id;
  if not found or v_owner is distinct from v_patient then
    raise exception 'Appointment not found.';
  end if;
  if v_status not in ('pending','scheduled') then
    raise exception 'Only upcoming appointments can be rescheduled.';
  end if;

  perform _assert_slot_bookable(p_doctor_id, p_scheduled_time);

  begin
    update appointments
    set doctor_id = p_doctor_id, scheduled_time = p_scheduled_time
    where id = p_appointment_id;
  exception when unique_violation then
    raise exception 'This appointment slot has already been booked. Please select another available time.';
  end;

  return jsonb_build_object(
    'success', true,
    'id', p_appointment_id,
    'message', 'Your appointment has been rescheduled successfully.'
  );
end;
$$ language plpgsql security definer;

-- Cancel an OWN upcoming appointment.
create or replace function cancel_appointment(p_appointment_id uuid)
returns jsonb as $$
declare
  v_patient uuid;
  v_owner uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to manage your appointments.';
  end if;
  v_patient := my_patient_id();
  if v_patient is null then
    raise exception 'We couldn''t find your patient profile. Please complete your profile and try again.';
  end if;

  select patient_id, status into v_owner, v_status
  from appointments where id = p_appointment_id;
  if not found or v_owner is distinct from v_patient then
    raise exception 'Appointment not found.';
  end if;
  if v_status in ('completed','cancelled','no_show') then
    raise exception 'This appointment can no longer be cancelled.';
  end if;

  update appointments set status = 'cancelled' where id = p_appointment_id;

  return jsonb_build_object(
    'success', true,
    'id', p_appointment_id,
    'message', 'Your appointment has been cancelled.'
  );
end;
$$ language plpgsql security definer;

-- ------------------------------------------------------------
-- 8) Grants
-- ------------------------------------------------------------
grant execute on function my_patient_id() to authenticated;
grant execute on function book_appointment(uuid, timestamptz, text) to authenticated;
grant execute on function reschedule_appointment(uuid, uuid, timestamptz) to authenticated;
grant execute on function cancel_appointment(uuid) to authenticated;
