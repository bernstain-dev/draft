-- ============================================================
-- MedicalAppointment — ONE-CLICK full.sql (schema + RLS + RPC + demo data).
-- Run the ENTIRE file once in Supabase SQL Editor. Safe to re-run:
-- every statement is IF NOT EXISTS / DROP IF EXISTS / CREATE OR REPLACE
-- / INSERT ... ON CONFLICT DO NOTHING.
--
-- What this file does:
--   1. Creates schema + RLS + booking RPCs (same as schema.sql).
--   2. Inserts demo directory data: 10 doctors + Mon-Sun schedules,
--      10 patients, appointments (yesterday / today /
--      tomorrow / next week), one visit note.
--   3. Does NOT create Auth logins (GoTrue passwords cannot be inserted
--      via SQL). After running this file, run:
--        node supabase/seed.cjs
--      with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env to create:
--        admin   vacunawa@gmail.com / admin123
--        patient patient@gmail.com / patient123 (linked to Maria Santos)
--      The seeder also links patient@gmail.com -> patients.user_id.
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

-- ============================================================
-- 7) DEMO DATA (same UUIDs as supabase/seed.cjs — seeder upserts
--    on the same ids, so running full.sql then seed.cjs never
--    duplicates. Safe to re-run: ON CONFLICT DO NOTHING.
--    Auth logins are NOT here (see header): run seed.cjs after.
-- ============================================================

-- ---- 7a) doctors (directory only — no doctor login; admin manages) ----
insert into doctors (id, profile_id, full_name, specialty, is_active) values
  ('a0000000-0000-0000-0000-000000000001', null, 'Dr. Ana Reyes', 'General medicine', true),
  ('a0000000-0000-0000-0000-000000000002', null, 'Dr. Mark Santos', 'Pediatrics', true),
  ('a0000000-0000-0000-0000-000000000003', null, 'Dr. Liza Cruz', 'OB-Gyne', true),
  ('a0000000-0000-0000-0000-000000000004', null, 'Dr. Paolo Bautista', 'Dentistry', true),
  ('a0000000-0000-0000-0000-000000000005', null, 'Dr. Jose Ramirez', 'Cardiology', true),
  ('a0000000-0000-0000-0000-000000000006', null, 'Dr. Kevin Lim', 'Dermatology', true),
  ('a0000000-0000-0000-0000-000000000007', null, 'Dra. Sofia Mendoza', 'Ophthalmology', true),
  ('a0000000-0000-0000-0000-000000000008', null, 'Dr. Daniel Torres', 'ENT', true),
  ('a0000000-0000-0000-0000-000000000009', null, 'Dra. Patricia Villanueva', 'Orthopedics', true),
  ('a0000000-0000-0000-0000-000000000010', null, 'Dr. Robert Garcia', 'Internal Medicine', true)
on conflict do nothing;

-- ---- 7b) schedules (Mon-Sun 08:00-17:00 x30m for EVERY doctor,
--      so every future date always has bookable slots.
--      IDs match seed.cjs exactly: per doctor, dows 1,2,3,4,5,6,0. ----
insert into doctor_schedules (id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes) values
  ('c0000000-0000-0000-0000-000000000101', 'a0000000-0000-0000-0000-000000000001', 1, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000102', 'a0000000-0000-0000-0000-000000000001', 2, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000103', 'a0000000-0000-0000-0000-000000000001', 3, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000104', 'a0000000-0000-0000-0000-000000000001', 4, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000105', 'a0000000-0000-0000-0000-000000000001', 5, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000106', 'a0000000-0000-0000-0000-000000000001', 6, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000107', 'a0000000-0000-0000-0000-000000000001', 0, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000108', 'a0000000-0000-0000-0000-000000000002', 1, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000109', 'a0000000-0000-0000-0000-000000000002', 2, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000110', 'a0000000-0000-0000-0000-000000000002', 3, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000111', 'a0000000-0000-0000-0000-000000000002', 4, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000112', 'a0000000-0000-0000-0000-000000000002', 5, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000113', 'a0000000-0000-0000-0000-000000000002', 6, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000114', 'a0000000-0000-0000-0000-000000000002', 0, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000115', 'a0000000-0000-0000-0000-000000000003', 1, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000116', 'a0000000-0000-0000-0000-000000000003', 2, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000117', 'a0000000-0000-0000-0000-000000000003', 3, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000118', 'a0000000-0000-0000-0000-000000000003', 4, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000119', 'a0000000-0000-0000-0000-000000000003', 5, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000120', 'a0000000-0000-0000-0000-000000000003', 6, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000121', 'a0000000-0000-0000-0000-000000000003', 0, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000122', 'a0000000-0000-0000-0000-000000000004', 1, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000123', 'a0000000-0000-0000-0000-000000000004', 2, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000124', 'a0000000-0000-0000-0000-000000000004', 3, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000125', 'a0000000-0000-0000-0000-000000000004', 4, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000126', 'a0000000-0000-0000-0000-000000000004', 5, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000127', 'a0000000-0000-0000-0000-000000000004', 6, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000128', 'a0000000-0000-0000-0000-000000000004', 0, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000129', 'a0000000-0000-0000-0000-000000000005', 1, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000130', 'a0000000-0000-0000-0000-000000000005', 2, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000131', 'a0000000-0000-0000-0000-000000000005', 3, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000132', 'a0000000-0000-0000-0000-000000000005', 4, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000133', 'a0000000-0000-0000-0000-000000000005', 5, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000134', 'a0000000-0000-0000-0000-000000000005', 6, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000135', 'a0000000-0000-0000-0000-000000000005', 0, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000136', 'a0000000-0000-0000-0000-000000000006', 1, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000137', 'a0000000-0000-0000-0000-000000000006', 2, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000138', 'a0000000-0000-0000-0000-000000000006', 3, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000139', 'a0000000-0000-0000-0000-000000000006', 4, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000140', 'a0000000-0000-0000-0000-000000000006', 5, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000141', 'a0000000-0000-0000-0000-000000000006', 6, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000142', 'a0000000-0000-0000-0000-000000000006', 0, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000143', 'a0000000-0000-0000-0000-000000000007', 1, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000144', 'a0000000-0000-0000-0000-000000000007', 2, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000145', 'a0000000-0000-0000-0000-000000000007', 3, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000146', 'a0000000-0000-0000-0000-000000000007', 4, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000147', 'a0000000-0000-0000-0000-000000000007', 5, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000148', 'a0000000-0000-0000-0000-000000000007', 6, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000149', 'a0000000-0000-0000-0000-000000000007', 0, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000150', 'a0000000-0000-0000-0000-000000000008', 1, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000151', 'a0000000-0000-0000-0000-000000000008', 2, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000152', 'a0000000-0000-0000-0000-000000000008', 3, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000153', 'a0000000-0000-0000-0000-000000000008', 4, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000154', 'a0000000-0000-0000-0000-000000000008', 5, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000155', 'a0000000-0000-0000-0000-000000000008', 6, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000156', 'a0000000-0000-0000-0000-000000000008', 0, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000157', 'a0000000-0000-0000-0000-000000000009', 1, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000158', 'a0000000-0000-0000-0000-000000000009', 2, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000159', 'a0000000-0000-0000-0000-000000000009', 3, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000160', 'a0000000-0000-0000-0000-000000000009', 4, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000161', 'a0000000-0000-0000-0000-000000000009', 5, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000162', 'a0000000-0000-0000-0000-000000000009', 6, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000163', 'a0000000-0000-0000-0000-000000000009', 0, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000164', 'a0000000-0000-0000-0000-000000000010', 1, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000165', 'a0000000-0000-0000-0000-000000000010', 2, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000166', 'a0000000-0000-0000-0000-000000000010', 3, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000167', 'a0000000-0000-0000-0000-000000000010', 4, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000168', 'a0000000-0000-0000-0000-000000000010', 5, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000169', 'a0000000-0000-0000-0000-000000000010', 6, '08:00', '17:00', 30),
  ('c0000000-0000-0000-0000-000000000170', 'a0000000-0000-0000-0000-000000000010', 0, '08:00', '17:00', 30)
on conflict do nothing;

-- ---- 7c) no blocked dates (every slot stays available) ----

-- ---- 7d) patients (user_id stays NULL here; seed.cjs links
--      patient@gmail.com -> Maria Santos b000...002 after signup) ----
insert into patients (id, full_name, date_of_birth, contact_number, address, user_id) values
  ('b0000000-0000-0000-0000-000000000001', 'Juan Dela Cruz', '1985-03-12', '09171234501', 'Poblacion, Bauang, La Union', null),
  ('b0000000-0000-0000-0000-000000000002', 'Maria Santos', '1990-07-22', '09171234502', 'Paringao, Bauang, La Union', null),
  ('b0000000-0000-0000-0000-000000000003', 'Pedro Reyes', '1955-01-05', '09171234503', 'Central West, Bauang, La Union', null),
  ('b0000000-0000-0000-0000-000000000004', 'Ana Lopez', '2022-05-10', '09171234504', 'Nagrebcan, Bauang, La Union', null),
  ('b0000000-0000-0000-0000-000000000005', 'Carmela Ramos', '1998-11-30', '09171234505', 'Pilar, Bauang, La Union', null),
  ('b0000000-0000-0000-0000-000000000006', 'Jose Manalo', '1948-09-18', '09171234506', 'Payocpoc, Bauang, La Union', null),
  ('b0000000-0000-0000-0000-000000000007', 'Grace Fernandez', '1975-02-14', '09171234507', 'Baccuit, Bauang, La Union', null),
  ('b0000000-0000-0000-0000-000000000008', 'Ramon Torres', '2001-06-25', '09171234508', 'Acao, Bauang, La Union', null),
  ('b0000000-0000-0000-0000-000000000009', 'Liza Gonzales', '1988-12-01', '09171234509', 'Cabalayangan, Bauang, La Union', null),
  ('b0000000-0000-0000-0000-000000000010', 'Mark Villanueva', '1965-04-09', '09171234510', 'Disso-or, Bauang, La Union', null)
on conflict do nothing;

-- ---- 7e) appointments: yesterday / today / tomorrow / next week ----
-- Times are relative to current_date so the demo always renders.
insert into appointments (id, patient_id, doctor_id, scheduled_time, source, status, room, checked_in_at, is_recurring, recurrence_parent_id) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', ((current_date - 1) + time '09:00')::timestamptz, 'pre_booked', 'completed', '1', ((current_date - 1) + time '08:55')::timestamptz, false, null),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', ((current_date - 1) + time '09:30')::timestamptz, 'pre_booked', 'no_show', null, null, false, null),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', (current_date + time '08:30')::timestamptz, 'walk_in', 'completed', '1', (current_date + time '08:28')::timestamptz, false, null),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', (current_date + time '09:00')::timestamptz, 'pre_booked', 'in_progress', '1', (current_date + time '08:50')::timestamptz, false, null),
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000002', (current_date + time '09:00')::timestamptz, 'pre_booked', 'waiting', '2', (current_date + time '08:45')::timestamptz, false, null),
  ('e0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', (current_date + time '09:30')::timestamptz, 'walk_in', 'checked_in', null, (current_date + time '09:20')::timestamptz, false, null),
  ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000003', (current_date + time '10:00')::timestamptz, 'pre_booked', 'scheduled', null, null, false, null),
  ('e0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', (current_date + time '10:30')::timestamptz, 'walk_in', 'scheduled', null, null, false, null),
  ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', (current_date + time '11:00')::timestamptz, 'pre_booked', 'cancelled', null, null, false, null),
  ('e0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000004', (current_date + time '13:00')::timestamptz, 'pre_booked', 'scheduled', null, null, false, null),
  ('e0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', ((current_date + 1) + time '09:00')::timestamptz, 'pre_booked', 'scheduled', null, null, true, 'e0000000-0000-0000-0000-000000000003'),
  ('e0000000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000002', ((current_date + 7) + time '10:00')::timestamptz, 'pre_booked', 'scheduled', null, null, false, null)
on conflict do nothing;

-- ---- 7f) visit note for today's completed appointment (...003) ----
insert into patient_visit_notes (id, patient_id, appointment_id, note) values
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000003', 'Mild fever and cough. Prescribed paracetamol, advised rest and follow-up in one week.')
on conflict do nothing;
