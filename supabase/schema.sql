-- ============================================================
-- MedicalAppointment — CLEAN full schema + RLS + patient booking.
-- Run the ENTIRE file once in Supabase SQL Editor. Safe to re-run:
-- every statement is IF NOT EXISTS / DROP IF EXISTS / CREATE OR REPLACE.
--
-- This is the single source of truth for FRESH installs:
--   1. Run this file (schema + RLS + booking RPCs).
--   2. Run `node supabase/seed.cjs` for accounts + demo data
--      (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env).
--
-- Upgrading an EXISTING database created with the old schema?
-- Run `supabase/migrate_patient_booking.sql` instead (it converges
-- the old schema to this one without dropping existing data).
--
-- Design notes:
--  * No Board Queuing system: no queue_number, no priority lane,
--    no queue_today view, no get_queue_today/can_access_queue.
--  * Roles: admin (manages everything) + patient (books own visits).
--    Admin manages schedules; patients book ONLY their own visits.
--  * Double-booking is blocked by unique index uq_doctor_slot.
--  * Booking RPCs derive the patient from auth.uid() — frontend
--    input is never trusted for identity.
-- ============================================================

-- 0) Extensions (Supabase usually has these; safe to re-run)
create extension if not exists "pgcrypto";

-- ============================================================
-- 1) TABLES
-- ============================================================

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin','patient')),
  device_label text,
  created_at timestamptz default now()
);

create table if not exists doctors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  full_name text not null,
  specialty text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists doctor_schedules (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid references doctors(id) on delete cascade not null,
  day_of_week int not null check (day_of_week between 0 and 6), -- 0=Sun
  start_time time not null,
  end_time time not null,
  slot_duration_minutes int not null default 30,
  check (start_time < end_time)
);

create table if not exists doctor_unavailable_dates (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid references doctors(id) on delete cascade not null,
  date date not null,
  reason text,
  unique (doctor_id, date)
);

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null, -- auth link for patient logins
  full_name text not null,
  date_of_birth date,
  contact_number text,
  address text,
  created_at timestamptz default now()
);

create index if not exists idx_patients_name on patients (lower(full_name));
create index if not exists idx_patients_contact on patients (contact_number);
create unique index if not exists uq_patients_user on patients (user_id);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete restrict not null,
  doctor_id uuid references doctors(id) on delete restrict not null,
  scheduled_time timestamptz not null,
  source text not null check (source in ('walk_in','pre_booked')) default 'pre_booked',
  is_recurring boolean default false,
  recurrence_parent_id uuid references appointments(id) on delete set null,
  status text not null check (status in (
    'pending','scheduled','checked_in','waiting','in_progress',
    'completed','cancelled','no_show'
  )) default 'scheduled',
  room text,
  reason text,
  checked_in_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Heal databases that predate the newer columns (fresh installs no-op).
alter table patients add column if not exists user_id uuid references profiles(id) on delete set null;
alter table appointments add column if not exists reason text;

create index if not exists idx_appts_doctor_time on appointments (doctor_id, scheduled_time);
create index if not exists idx_appts_patient on appointments (patient_id);
create index if not exists idx_appts_status on appointments (status);
-- NOTE: no expression index on (scheduled_time::date): casting timestamptz
-- to date depends on the session timezone (STABLE, not IMMUTABLE) and
-- Postgres rejects it in index expressions (42P17). The plain btree below
-- serves all day-range queries (gte/lte on scheduled_time).
create index if not exists idx_appts_sched_time on appointments (scheduled_time);

-- prevent double-booking: same doctor, same slot, unless cancelled/no_show
-- NOTE: keep intact. Do not relax this predicate.
create unique index if not exists uq_doctor_slot
  on appointments (doctor_id, scheduled_time)
  where status not in ('cancelled','no_show');

create table if not exists patient_visit_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade not null,
  appointment_id uuid references appointments(id) on delete set null,
  note text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_notes_patient on patient_visit_notes (patient_id);
create index if not exists idx_notes_appointment on patient_visit_notes (appointment_id);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id) on delete set null,
  action text not null, -- 'create','status_change','reschedule','cancel','update'
  entity text not null,  -- 'appointment','patient','doctor', etc.
  entity_id uuid not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_audit_entity on audit_log (entity, entity_id);
create index if not exists idx_audit_actor on audit_log (actor_id);

-- ============================================================
-- 2) AUTOMATION: updated_at + audit
-- ============================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_appointments_updated_at on appointments;
create trigger trg_appointments_updated_at
  before update on appointments
  for each row execute function set_updated_at();

-- Audit trigger: logs status changes, reschedules, creates, cancels.
create or replace function audit_appointment_changes()
returns trigger as $$
declare
  v_action text;
begin
  if (TG_OP = 'INSERT') then
    v_action := 'create';
    insert into audit_log (actor_id, action, entity, entity_id, old_value, new_value)
    values (new.created_by, v_action, 'appointment', new.id, null, to_jsonb(new));
    return new;
  elsif (TG_OP = 'UPDATE') then
    if (old.status is distinct from new.status) then
      if new.status = 'cancelled' then v_action := 'cancel';
      else v_action := 'status_change'; end if;
    elsif (old.scheduled_time is distinct from new.scheduled_time) then
      v_action := 'reschedule';
    else
      v_action := 'update';
    end if;
    insert into audit_log (actor_id, action, entity, entity_id, old_value, new_value)
    values (auth.uid(), v_action, 'appointment', new.id, to_jsonb(old), to_jsonb(new));
    return new;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_audit_appointments on appointments;
create trigger trg_audit_appointments
  after insert or update on appointments
  for each row execute function audit_appointment_changes();

-- ============================================================
-- 3) HELPERS
-- ============================================================

-- Admin check that never recurses: runs as the function owner (who bypasses
-- RLS), so policies on `profiles` itself can safely call it. A policy that
-- SELECTs from profiles inside its own USING clause causes
-- "infinite recursion detected" — never do that (see profiles_admin_all).
create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where profiles.id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- Patient identity (SECURITY DEFINER so RLS on `patients` itself can
-- never recurse through it). Returns the caller's row in `patients`.
create or replace function my_patient_id()
returns uuid as $$
  select p.id from patients p where p.user_id = auth.uid() limit 1;
$$ language sql security definer stable;

-- ============================================================
-- 4) RLS
-- ============================================================

alter table profiles enable row level security;
alter table doctors enable row level security;
alter table doctor_schedules enable row level security;
alter table doctor_unavailable_dates enable row level security;
alter table patients enable row level security;
alter table patient_visit_notes enable row level security;
alter table appointments enable row level security;
alter table audit_log enable row level security;

-- Drop old policies if re-running (names from earlier revisions)
drop policy if exists "staff_full_access_appointments" on appointments;
drop policy if exists "staff_full_access_patients" on patients;
drop policy if exists "staff_full_access_doctors" on doctors;
drop policy if exists "staff_read_own_profile" on profiles;
drop policy if exists "staff_full_access_audit" on audit_log;
drop policy if exists "profiles_select_own" on profiles;
drop policy if exists "profiles_insert_own" on profiles;
drop policy if exists "profiles_update_own" on profiles;
drop policy if exists "profiles_admin_all" on profiles;
drop policy if exists "staff_all_doctors" on doctors;
drop policy if exists "staff_all_schedules" on doctor_schedules;
drop policy if exists "staff_all_unavailable" on doctor_unavailable_dates;
drop policy if exists "staff_all_patients" on patients;
drop policy if exists "staff_all_notes" on patient_visit_notes;
drop policy if exists "staff_all_appointments" on appointments;
drop policy if exists "audit_admin_select" on audit_log;
drop policy if exists "audit_staff_insert" on audit_log;
drop policy if exists "patient_read_doctors" on doctors;
drop policy if exists "patient_read_schedules" on doctor_schedules;
drop policy if exists "patient_read_unavailable" on doctor_unavailable_dates;
drop policy if exists "patient_select_own" on patients;
drop policy if exists "patient_insert_own" on patients;
drop policy if exists "patient_update_own" on patients;
drop policy if exists "patient_select_own_appointments" on appointments;
drop policy if exists "patient_insert_own_appointments" on appointments;
drop policy if exists "patient_update_own_appointments" on appointments;

-- ---- profiles ----
-- Every signed-in user can read their own row (needed to resolve role).
create policy "profiles_select_own" on profiles
  for select using (id = auth.uid());

-- Signup self-insert: user may create exactly their own profile row.
create policy "profiles_insert_own" on profiles
  for insert with check (id = auth.uid());

-- Every user may keep their own display name in sync.
create policy "profiles_update_own" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Admins can manage all profiles.
-- Uses is_admin() (SECURITY DEFINER) — a direct subquery on profiles here
-- would recurse infinitely.
create policy "profiles_admin_all" on profiles
  for all using (is_admin()) with check (is_admin());

-- ---- clinical tables: admin-only ----
create policy "staff_all_doctors" on doctors
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  );

create policy "staff_all_schedules" on doctor_schedules
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  );

create policy "staff_all_unavailable" on doctor_unavailable_dates
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  );

create policy "staff_all_patients" on patients
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  );

create policy "staff_all_notes" on patient_visit_notes
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  );

create policy "staff_all_appointments" on appointments
  for all using (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  ) with check (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  );

-- ---- patient access ----
-- Patients may read ACTIVE doctors (needed for "Choose a Doctor").
create policy "patient_read_doctors" on doctors
  for select using (
    is_active = true
    and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'patient')
  );

-- Patients may read schedules / blocked dates of active doctors
-- (needed for "Choose a Date" / "Choose an Available Time").
create policy "patient_read_schedules" on doctor_schedules
  for select using (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'patient')
    and exists (select 1 from doctors d where d.id = doctor_schedules.doctor_id and d.is_active = true)
  );

create policy "patient_read_unavailable" on doctor_unavailable_dates
  for select using (
    exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'patient')
    and exists (select 1 from doctors d where d.id = doctor_unavailable_dates.doctor_id and d.is_active = true)
  );

-- Patients own exactly one row in `patients` (via user_id).
create policy "patient_select_own" on patients
  for select using (user_id = auth.uid());

create policy "patient_insert_own" on patients
  for insert with check (user_id = auth.uid());

create policy "patient_update_own" on patients
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Appointments: patients see and manage ONLY their own rows.
-- Rows are always saved under the authenticated patient
-- (my_patient_id()), never a frontend-supplied id.
create policy "patient_select_own_appointments" on appointments
  for select using (patient_id = my_patient_id());

create policy "patient_insert_own_appointments" on appointments
  for insert with check (patient_id = my_patient_id());

create policy "patient_update_own_appointments" on appointments
  for update using (patient_id = my_patient_id())
  with check (patient_id = my_patient_id());

-- ---- audit_log ----
-- Admin may INSERT via app/trigger context; only admin may read.
-- (The audit trigger itself is SECURITY DEFINER so INSERTs from the
-- trigger always succeed even if the RLS INSERT check below changes.)
create policy "audit_staff_insert" on audit_log
  for insert with check (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  );

create policy "audit_admin_select" on audit_log
  for select using (
    exists (select 1 from profiles pr where pr.id = auth.uid()
            and pr.role = 'admin')
  );

-- ============================================================
-- 5) BOOKING RPCs (backend validation — the frontend ALSO
--    validates, but the backend never trusts it)
--
-- Timezone note: doctor_schedules store LOCAL wall-clock times for the
-- clinic (Asia/Manila). Slot validation therefore interprets the
-- requested instant in Asia/Manila, matching the patient portal which
-- builds slots from the same schedules.
-- ============================================================

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

-- Book under the authenticated patient.
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

-- ============================================================
-- 6) GRANTS — least privilege
-- ============================================================

revoke all on table profiles, doctors, doctor_schedules,
  doctor_unavailable_dates, patients, patient_visit_notes,
  appointments, audit_log from anon;
grant all on table profiles, doctors, doctor_schedules,
  doctor_unavailable_dates, patients, patient_visit_notes,
  appointments, audit_log to authenticated;
-- RLS above is what actually restricts rows.

grant execute on function is_admin() to authenticated;
grant execute on function my_patient_id() to authenticated;
grant execute on function book_appointment(uuid, timestamptz, text) to authenticated;
grant execute on function reschedule_appointment(uuid, uuid, timestamptz) to authenticated;
grant execute on function cancel_appointment(uuid) to authenticated;
