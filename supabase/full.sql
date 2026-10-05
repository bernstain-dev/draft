-- Fresh-install schema plus trusted demo seeds; never use demo seeds in production.
-- ============================================================
-- MedicalAppointment — CLEAN full schema + RLS + patient booking.
-- Run the ENTIRE file once in Supabase SQL Editor. Safe to re-run:
-- every statement is IF NOT EXISTS / DROP IF EXISTS / CREATE OR REPLACE.
--
-- This is the single source of truth for FRESH installs:
--   1. Run this file (schema + RLS + booking RPCs).
--      TIP: `supabase/full.sql` is the one-click alternative — same
--      schema plus demo data (10 doctors, schedules, patients,
--      appointments) in a single run.
--   2. Run `node supabase/seed.cjs` for accounts + demo data
--      (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env).
--
-- Upgrading an EXISTING database created with the old schema?
-- Post-cleanup existing installations: run fix_phase1_security.sql only.
-- Pre-cleanup installations: run migrate_patient_booking.sql (it converges
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
    insert into public.audit_log (actor_id, action, entity, entity_id, old_value, new_value)
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
    insert into public.audit_log (actor_id, action, entity, entity_id, old_value, new_value)
    values (auth.uid(), v_action, 'appointment', new.id, to_jsonb(old), to_jsonb(new));
    return new;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = '';

drop trigger if exists trg_audit_appointments on appointments;
create trigger trg_audit_appointments
  after insert or update on appointments
  for each row execute function audit_appointment_changes();

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

-- Clinical table grants are unchanged; protected-table grants are below.
revoke all on table doctors, doctor_schedules, doctor_unavailable_dates,
  patients, patient_visit_notes, audit_log from anon;
grant all on table doctors, doctor_schedules, doctor_unavailable_dates,
  patients, patient_visit_notes, audit_log to authenticated;

begin;
-- BEGIN CANONICAL PHASE 1 SECURITY
-- This block is identical in schema.sql, full.sql and the legacy upgrade.
lock table public.profiles, public.appointments in share row exclusive mode;
alter table public.profiles alter column role set default 'patient';
alter table public.profiles enable row level security;
alter table public.appointments enable row level security;

-- Preserve the existing unique index and reject unexpected definitions.
create unique index if not exists uq_doctor_slot
  on public.appointments (doctor_id, scheduled_time)
  where status not in ('cancelled','no_show');
do $$
declare v_index record;
begin
  select i.indisunique, i.indisvalid, i.indnkeyatts,
    pg_get_indexdef(i.indexrelid, 1, true) as col1,
    pg_get_indexdef(i.indexrelid, 2, true) as col2,
    pg_get_expr(i.indpred, i.indrelid) as predicate
  into v_index
  from pg_index i
  where i.indexrelid = 'public.uq_doctor_slot'::regclass
    and i.indrelid = 'public.appointments'::regclass;
  if not found or not v_index.indisunique or not v_index.indisvalid
    or v_index.indnkeyatts <> 2 or v_index.col1 <> 'doctor_id'
    or v_index.col2 <> 'scheduled_time'
    or v_index.predicate is distinct from
      '(status <> ALL (ARRAY[''cancelled''::text, ''no_show''::text]))' then
    raise exception 'Unexpected uq_doctor_slot definition; migration aborted without changing records.';
  end if;
end $$;

-- Remove every old policy on these two tables: permissive policies combine
-- with OR, so retaining an unknown legacy policy would leave a bypass.
do $$
declare r record; v_columns text;
begin
  for r in select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('profiles','appointments') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  for r in select unnest(array['profiles','appointments']) as tablename loop
    execute format('revoke all on table public.%I from public, anon, authenticated', r.tablename);
    select string_agg(quote_ident(attname), ', ') into v_columns
    from pg_attribute where attrelid = format('public.%I', r.tablename)::regclass
      and attnum > 0 and not attisdropped;
    -- Table revocation alone does not remove previously granted column ACLs.
    execute format('revoke select (%s), insert (%s), update (%s), references (%s) on public.%I from public, anon, authenticated',
      v_columns, v_columns, v_columns, v_columns, r.tablename);
  end loop;
end $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin');
$$;
create or replace function public.my_patient_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.patients p where p.user_id = auth.uid() limit 1;
$$;

grant select on public.profiles to authenticated;
grant insert (id, full_name) on public.profiles to authenticated;
grant update (full_name, device_label) on public.profiles to authenticated;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid() and role = 'patient');
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_select on public.profiles
  for select to authenticated using (public.is_admin());
create policy profiles_admin_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- No browser role, including admins, can mutate appointments directly.
grant select on public.appointments to authenticated;
create policy patient_select_own_appointments on public.appointments
  for select to authenticated using (patient_id = public.my_patient_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'patient'));
create policy staff_select_appointments on public.appointments
  for select to authenticated using (public.is_admin());

-- Lock the actor's role while an operation runs, so admin demotion cannot
-- race a privileged operation that already checked its caller.
create or replace function public._require_admin()
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid() for share;
  if v_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Administrator authorization required.';
  end if;
end;
$$;
create or replace function public._require_patient()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_role text; v_patient uuid;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid() for share;
  if v_role is distinct from 'patient' then
    raise exception using errcode = '42501', message = 'Patient authorization required.';
  end if;
  select p.id into v_patient from public.patients p where p.user_id = auth.uid();
  if v_patient is null then
    raise exception 'Patient record missing. Complete your profile or contact the clinic.';
  end if;
  return v_patient;
end;
$$;

create or replace function public.admin_set_profile_role(p_profile_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  perform public._require_admin();
  if p_profile_id = auth.uid() then raise exception 'You cannot change your own administrative role.'; end if;
  if p_role is null or p_role not in ('admin','patient') then raise exception 'Invalid role.'; end if;
  select p.role into v_old from public.profiles p where p.id = p_profile_id for update;
  if not found then raise exception 'Profile not found.'; end if;
  update public.profiles set role = p_role where id = p_profile_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, old_value, new_value)
    values (auth.uid(), 'role_change', 'profile', p_profile_id,
      jsonb_build_object('role', v_old), jsonb_build_object('role', p_role));
  return jsonb_build_object('success', true, 'id', p_profile_id);
end;
$$;

-- One schedule validator for every patient/staff booking and rescheduling.
-- The existing clinic interpretation (Asia/Manila) is retained.
create or replace function public._assert_slot_bookable(p_doctor_id uuid, p_scheduled_time timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_local timestamp; v_active boolean;
begin
  if p_scheduled_time is null or not isfinite(p_scheduled_time) or p_scheduled_time <= now() then
    raise exception 'Please choose a future date and time for your appointment.';
  end if;
  if date_trunc('minute', p_scheduled_time) <> p_scheduled_time then
    raise exception 'Appointment time must match a whole-minute schedule slot.';
  end if;
  select d.is_active into v_active from public.doctors d where d.id = p_doctor_id for share;
  if v_active is distinct from true then raise exception 'This doctor is not available for appointments.'; end if;
  v_local := p_scheduled_time at time zone 'Asia/Manila';
  if exists (select 1 from public.doctor_unavailable_dates u
      where u.doctor_id = p_doctor_id and u.date = v_local::date) then
    raise exception 'This doctor is unavailable on the selected date.';
  end if;
  if not exists (select 1 from public.doctor_schedules s
    where s.doctor_id = p_doctor_id and s.day_of_week = extract(dow from v_local)::int
      and s.slot_duration_minutes > 0 and s.start_time < s.end_time
      and v_local::time >= s.start_time
      and v_local::time + make_interval(mins => s.slot_duration_minutes) <= s.end_time
      and (v_local::time - s.start_time) + make_interval(mins => s.slot_duration_minutes)
        <= s.end_time - s.start_time
      and mod(extract(epoch from (v_local::time - s.start_time)),
        nullif(s.slot_duration_minutes, 0) * 60) = 0) then
    raise exception 'This appointment time is not a valid available schedule slot.';
  end if;
  -- Occupancy is enforced atomically by uq_doctor_slot, not a racy SELECT.
end;
$$;

create or replace function public.book_appointment(
  p_doctor_id uuid, p_scheduled_time timestamptz, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; v_id uuid;
begin
  v_patient := public._require_patient();
  perform public._assert_slot_bookable(p_doctor_id, p_scheduled_time);
  insert into public.appointments (patient_id, doctor_id, scheduled_time, source, status, reason, created_by)
    values (v_patient, p_doctor_id, p_scheduled_time, 'pre_booked', 'scheduled', nullif(btrim(p_reason), ''), auth.uid())
    returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'This appointment slot has already been booked. Please select another available time.';
end;
$$;

create or replace function public.staff_book_appointment(
  p_patient_id uuid, p_doctor_id uuid, p_scheduled_time timestamptz,
  p_source text default 'pre_booked', p_room text default null,
  p_reason text default null, p_recurrence_parent_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public._require_admin();
  if not exists (select 1 from public.patients p where p.id = p_patient_id) then raise exception 'Patient not found.'; end if;
  if p_source is null or p_source not in ('pre_booked','walk_in') then raise exception 'Invalid appointment source.'; end if;
  if p_recurrence_parent_id is not null and not exists (select 1 from public.appointments a
      where a.id = p_recurrence_parent_id and a.patient_id = p_patient_id) then
    raise exception 'Follow-up appointment must belong to the selected patient.';
  end if;
  perform public._assert_slot_bookable(p_doctor_id, p_scheduled_time);
  insert into public.appointments (patient_id, doctor_id, scheduled_time, source, status, room,
      reason, is_recurring, recurrence_parent_id, created_by)
    values (p_patient_id, p_doctor_id, p_scheduled_time, p_source, 'scheduled', nullif(btrim(p_room), ''),
      nullif(btrim(p_reason), ''), p_recurrence_parent_id is not null, p_recurrence_parent_id, auth.uid())
    returning id into v_id;
  if nullif(btrim(p_reason), '') is not null then
    insert into public.patient_visit_notes (patient_id, appointment_id, note, created_by)
      values (p_patient_id, v_id, btrim(p_reason), auth.uid());
  end if;
  return jsonb_build_object('success', true, 'id', v_id);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'This appointment slot has already been booked. Please select another available time.';
end;
$$;

-- Private worker; NULL owner means admin, never anonymous access.
create or replace function public._reschedule_appointment(
  p_appointment_id uuid, p_doctor_id uuid, p_scheduled_time timestamptz, p_owner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.appointments%rowtype;
begin
  if p_owner is null then perform public._require_admin();
  elsif p_owner is distinct from public._require_patient() then
    raise exception using errcode = '42501', message = 'Patient authorization required.';
  end if;
  select * into v_row from public.appointments where id = p_appointment_id for update;
  if not found or (p_owner is not null and v_row.patient_id is distinct from p_owner) then
    raise exception 'Appointment not found.';
  end if;
  if v_row.status not in ('pending','scheduled') or v_row.scheduled_time <= now() then
    raise exception 'Only upcoming pending or scheduled appointments can be rescheduled.';
  end if;
  perform public._assert_slot_bookable(p_doctor_id, p_scheduled_time);
  update public.appointments set doctor_id = p_doctor_id, scheduled_time = p_scheduled_time where id = p_appointment_id;
  return jsonb_build_object('success', true, 'id', p_appointment_id);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'This appointment slot has already been booked. Please select another available time.';
end;
$$;
create or replace function public.reschedule_appointment(p_appointment_id uuid, p_doctor_id uuid, p_scheduled_time timestamptz)
returns jsonb language sql security definer set search_path = '' as $$
  select public._reschedule_appointment(p_appointment_id, p_doctor_id, p_scheduled_time, public._require_patient());
$$;
create or replace function public.staff_reschedule_appointment(p_appointment_id uuid, p_doctor_id uuid, p_scheduled_time timestamptz)
returns jsonb language sql security definer set search_path = '' as $$
  select public._reschedule_appointment(p_appointment_id, p_doctor_id, p_scheduled_time, null);
$$;

create or replace function public._cancel_appointment(p_appointment_id uuid, p_owner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.appointments%rowtype;
begin
  if p_owner is null then perform public._require_admin();
  elsif p_owner is distinct from public._require_patient() then
    raise exception using errcode = '42501', message = 'Patient authorization required.';
  end if;
  select * into v_row from public.appointments where id = p_appointment_id for update;
  if not found or (p_owner is not null and v_row.patient_id is distinct from p_owner) then raise exception 'Appointment not found.'; end if;
  if v_row.status not in ('pending','scheduled','checked_in','waiting','in_progress') then
    raise exception 'This appointment can no longer be cancelled.';
  end if;
  if p_owner is not null and (v_row.status not in ('pending','scheduled') or v_row.scheduled_time <= now()) then
    raise exception 'Patients can cancel only upcoming pending or scheduled appointments.';
  end if;
  update public.appointments set status = 'cancelled' where id = p_appointment_id;
  return jsonb_build_object('success', true, 'id', p_appointment_id);
end;
$$;
create or replace function public.cancel_appointment(p_appointment_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public._cancel_appointment(p_appointment_id, public._require_patient());
$$;
create or replace function public.staff_cancel_appointment(p_appointment_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public._cancel_appointment(p_appointment_id, null);
$$;

create or replace function public.staff_check_in_appointment(p_appointment_id uuid, p_room text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.appointments%rowtype;
begin
  perform public._require_admin();
  select * into v_row from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if (v_row.scheduled_time at time zone 'Asia/Manila')::date <> (now() at time zone 'Asia/Manila')::date then
    raise exception 'Check-in is allowed only on the appointment clinic date.';
  end if;
  if v_row.status = 'checked_in' then return jsonb_build_object('success', true, 'id', p_appointment_id); end if;
  if v_row.status <> 'scheduled' then raise exception 'Only scheduled appointments can be checked in.'; end if;
  update public.appointments set status = 'checked_in', checked_in_at = now(),
    room = coalesce(nullif(btrim(p_room), ''), room) where id = p_appointment_id;
  return jsonb_build_object('success', true, 'id', p_appointment_id);
end;
$$;

create or replace function public.staff_set_appointment_status(p_appointment_id uuid, p_status text, p_room text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.appointments%rowtype;
begin
  perform public._require_admin();
  if p_status is null or p_status not in ('scheduled','waiting','in_progress','completed','no_show') then
    raise exception 'Use the authorized check-in or cancellation operation for that action.';
  end if;
  select * into v_row from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found.'; end if;
  if v_row.status = p_status then return jsonb_build_object('success', true, 'id', p_appointment_id); end if;
  if not ((v_row.status = 'pending' and p_status = 'scheduled')
    or (v_row.status = 'checked_in' and p_status = 'waiting')
    or (v_row.status = 'waiting' and p_status = 'in_progress')
    or (v_row.status = 'in_progress' and p_status = 'completed')
    or (v_row.status in ('pending','scheduled') and p_status = 'no_show' and v_row.scheduled_time <= now())) then
    raise exception 'Invalid appointment status transition.';
  end if;
  if p_status in ('waiting','in_progress','completed')
    and (v_row.scheduled_time at time zone 'Asia/Manila')::date <> (now() at time zone 'Asia/Manila')::date then
    raise exception 'Clinical progression is allowed only on the appointment clinic date.';
  end if;
  update public.appointments set status = p_status,
    room = coalesce(nullif(btrim(p_room), ''), room) where id = p_appointment_id;
  return jsonb_build_object('success', true, 'id', p_appointment_id);
end;
$$;

-- Existing history trigger retained; harden its definer context.
create or replace function public.audit_appointment_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_action text;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, entity, entity_id, old_value, new_value)
      values (new.created_by, 'create', 'appointment', new.id, null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    v_action := case when old.status is distinct from new.status then
      case when new.status = 'cancelled' then 'cancel' else 'status_change' end
      when old.scheduled_time is distinct from new.scheduled_time or old.doctor_id is distinct from new.doctor_id then 'reschedule'
      else 'update' end;
    insert into public.audit_log (actor_id, action, entity, entity_id, old_value, new_value)
      values (auth.uid(), v_action, 'appointment', new.id, to_jsonb(old), to_jsonb(new));
    return new;
  end if;
  return null;
end;
$$;
alter function public.set_updated_at() set search_path = '';

-- Explicit execution ACLs also remove default PUBLIC execute and inherited
-- direct grants from anon/authenticated on previously defined functions.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as signature, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'is_admin','my_patient_id','_require_admin','_require_patient','admin_set_profile_role',
      '_assert_slot_bookable','book_appointment','staff_book_appointment',
      '_reschedule_appointment','reschedule_appointment','staff_reschedule_appointment',
      '_cancel_appointment','cancel_appointment','staff_cancel_appointment',
      'staff_check_in_appointment','staff_set_appointment_status','audit_appointment_changes','set_updated_at']) loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
  end loop;
end $$;
grant execute on function public.is_admin(), public.my_patient_id() to authenticated;
grant execute on function public.admin_set_profile_role(uuid, text) to authenticated;
grant execute on function public.book_appointment(uuid, timestamptz, text) to authenticated;
grant execute on function public.reschedule_appointment(uuid, uuid, timestamptz), public.cancel_appointment(uuid) to authenticated;
grant execute on function public.staff_book_appointment(uuid, uuid, timestamptz, text, text, text, uuid) to authenticated;
grant execute on function public.staff_reschedule_appointment(uuid, uuid, timestamptz), public.staff_cancel_appointment(uuid) to authenticated;
grant execute on function public.staff_check_in_appointment(uuid, text), public.staff_set_appointment_status(uuid, text, text) to authenticated;
-- END CANONICAL PHASE 1 SECURITY
commit;

begin;
-- BEGIN CANONICAL PHASE 2 AVAILABILITY
lock table public.doctor_schedules, public.doctor_unavailable_dates, public.patients, public.appointments in share row exclusive mode;
create extension if not exists btree_gist;

-- Report bad row IDs/counts only; never silently repair/delete schedules.
do $$
declare v_bad integer; v_ids text; v_overlap integer; v_pairs text; v_bad_times integer;
begin
  select count(*), string_agg(id::text, ', ' order by id) into v_bad, v_ids
  from public.doctor_schedules where slot_duration_minutes not between 1 and 1440
    or start_time >= end_time or extract(second from start_time) <> 0
    or extract(second from end_time) <> 0
    or slot_duration_minutes * 60::bigint > extract(epoch from (end_time - start_time));
  select count(*), string_agg(a.id::text || '/' || b.id::text, ', ' order by a.id, b.id) into v_overlap, v_pairs from public.doctor_schedules a join public.doctor_schedules b
    on a.id < b.id and a.doctor_id = b.doctor_id and a.day_of_week = b.day_of_week
      and a.start_time < b.end_time and b.start_time < a.end_time;
  select count(*) into v_bad_times from public.appointments where not isfinite(scheduled_time)
    or extract(second from scheduled_time at time zone 'Asia/Manila') <> 0;
  if v_bad_times > 0 then
    raise exception 'Phase 2 aborted: % appointment timestamp(s) are not finite whole-minute instants. Review privately; no records changed.', v_bad_times;
  end if;
  if v_bad > 0 or v_overlap > 0 then
    raise exception 'Phase 2 aborted: % invalid schedule row(s), % duplicate/overlapping pair(s). Invalid schedule IDs: %. Overlapping schedule ID pairs: %. No records changed.',
      v_bad, v_overlap, coalesce(v_ids, 'none'), coalesce(v_pairs, 'none');
  end if;
end $$;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.appointments'::regclass and conname = 'phase2_appointment_minute_check') then
    alter table public.appointments add constraint phase2_appointment_minute_check check (
      isfinite(scheduled_time) and extract(second from scheduled_time at time zone 'Asia/Manila') = 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.doctor_schedules'::regclass and conname = 'phase2_schedule_minutes_check') then
    alter table public.doctor_schedules add constraint phase2_schedule_minutes_check check (
      slot_duration_minutes between 1 and 1440 and start_time < end_time
      and extract(second from start_time) = 0 and extract(second from end_time) = 0
      and slot_duration_minutes * 60::bigint <= extract(epoch from (end_time - start_time)));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.doctor_schedules'::regclass and conname = 'phase2_schedule_no_overlap') then
    alter table public.doctor_schedules add constraint phase2_schedule_no_overlap exclude using gist (
      doctor_id with =, day_of_week with =,
      int4range((extract(epoch from start_time) / 60)::int,
        (extract(epoch from end_time) / 60)::int, '[)') with &&);
  end if;
end $$;

-- Candidate slots: shared by availability and authoritative mutation validator.
-- Even before constraints, invalid schedule rows generate no slots and repeated
-- valid rows cannot duplicate a timestamp. No identity/appointment data returned.
create or replace function public._clinic_schedule_slots(p_doctor_id uuid, p_date date)
returns table (scheduled_time timestamptz, slot_duration_minutes integer)
language sql stable security definer set search_path = '' as $$
  select distinct (g.local_slot at time zone 'Asia/Manila'), s.slot_duration_minutes
  from public.doctor_schedules s
  join public.doctors d on d.id = s.doctor_id and d.is_active
  cross join lateral generate_series(p_date + s.start_time,
    p_date + s.end_time - make_interval(mins => case when s.slot_duration_minutes between 1 and 1440 then s.slot_duration_minutes else 1440 end),
    make_interval(mins => case when s.slot_duration_minutes between 1 and 1440 then s.slot_duration_minutes else 1440 end)) g(local_slot)
  where d.id = p_doctor_id and isfinite(p_date)
    and s.day_of_week = extract(dow from p_date)::int
    and s.slot_duration_minutes between 1 and 1440 and s.start_time < s.end_time
    and extract(second from s.start_time) = 0 and extract(second from s.end_time) = 0
    and (g.local_slot at time zone 'Asia/Manila') > now()
    and not exists (select 1 from public.doctor_unavailable_dates u where u.doctor_id = d.id and u.date = p_date);
$$;

create or replace function public.get_available_appointment_slots(p_doctor_id uuid, p_date date)
returns table (scheduled_time timestamptz, slot_duration_minutes integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('patient','admin') then
    raise exception using errcode = '42501', message = 'Patient or administrator authorization required.';
  end if;
  if p_date is null or not isfinite(p_date) then raise exception 'Select a valid clinic date.'; end if;
  return query select s.scheduled_time, s.slot_duration_minutes
    from public._clinic_schedule_slots(p_doctor_id, p_date) s
    where not exists (select 1 from public.appointments a
      where a.doctor_id = p_doctor_id and a.scheduled_time = s.scheduled_time
        and a.status not in ('cancelled','no_show'))
    order by s.scheduled_time;
end;
$$;

-- Calendar flags are derived from the same available-slot RPC, not React rules.
create or replace function public.get_available_appointment_dates(p_doctor_id uuid, p_start date, p_days integer default 30)
returns table (clinic_date date, available boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_start is null or not isfinite(p_start) or p_days is null or p_days not between 1 and 60 then
    raise exception 'Select a valid clinic calendar range (1 to 60 days).';
  end if;
  -- Verify even when a doctor has no schedule or the range is entirely past.
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('patient','admin')) then
    raise exception using errcode = '42501', message = 'Patient or administrator authorization required.';
  end if;
  return query select p_start + d, exists (select 1 from public.get_available_appointment_slots(p_doctor_id, p_start + d))
    from generate_series(0, p_days - 1) d order by d;
end;
$$;

-- Retain Phase 1 authorization, whole-minute rejection, future checks and
-- final unique index enforcement. Both booking/rescheduling portals call this.
create or replace function public._assert_slot_bookable(p_doctor_id uuid, p_scheduled_time timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_active boolean; v_date date;
begin
  if p_scheduled_time is null or not isfinite(p_scheduled_time) or p_scheduled_time <= now() then
    raise exception 'Please choose a future date and time for your appointment.';
  end if;
  if date_trunc('minute', p_scheduled_time) <> p_scheduled_time then
    raise exception 'Appointment time must match a whole-minute schedule slot.';
  end if;
  select d.is_active into v_active from public.doctors d where d.id = p_doctor_id for share;
  if v_active is distinct from true then raise exception 'This doctor is not available for appointments.'; end if;
  v_date := (p_scheduled_time at time zone 'Asia/Manila')::date;
  if exists (select 1 from public.doctor_unavailable_dates u where u.doctor_id = p_doctor_id and u.date = v_date) then
    raise exception 'This doctor is unavailable on the selected date.';
  end if;
  if not exists (select 1 from public._clinic_schedule_slots(p_doctor_id, v_date) s where s.scheduled_time = p_scheduled_time) then
    raise exception 'This appointment time is not a valid available schedule slot.';
  end if;
end;
$$;

-- Calendar changes lock the same doctor row as booking validation, in
-- deterministic order when moving rows between doctors. Blocked-date INSERT
-- and UPDATE have a trigger guard, so direct staff writes cannot bypass it.
create or replace function public._guard_doctor_calendar_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old uuid; v_new uuid; v_count integer; v_date date;
begin
  if tg_op <> 'INSERT' then v_old := old.doctor_id; end if;
  if tg_op <> 'DELETE' then v_new := new.doctor_id; end if;
  perform d.id from public.doctors d where d.id in (v_old, v_new) order by d.id for update;
  if tg_table_name = 'doctor_unavailable_dates' and tg_op <> 'DELETE' then
    if tg_op = 'INSERT' or new.doctor_id is distinct from old.doctor_id or new.date is distinct from old.date then
      v_date := new.date;
      if v_date is null or not isfinite(v_date) or v_date < (now() at time zone 'Asia/Manila')::date then
        raise exception 'Select today or a future clinic date.';
      end if;
      select count(*) into v_count from public.appointments a where a.doctor_id = new.doctor_id
        and a.scheduled_time >= (v_date::timestamp at time zone 'Asia/Manila')
        and a.scheduled_time < ((v_date + 1)::timestamp at time zone 'Asia/Manila')
        and a.status not in ('cancelled','no_show');
      if v_count > 0 then
        raise exception using errcode = '23514', message = format('Cannot block this date: %s appointments conflict. Reschedule or cancel them explicitly first.', v_count);
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists phase2_guard_schedules on public.doctor_schedules;
create trigger phase2_guard_schedules before insert or update or delete on public.doctor_schedules
  for each row execute function public._guard_doctor_calendar_change();
drop trigger if exists phase2_guard_unavailable on public.doctor_unavailable_dates;
create trigger phase2_guard_unavailable before insert or update or delete on public.doctor_unavailable_dates
  for each row execute function public._guard_doctor_calendar_change();

create or replace function public.staff_block_doctor_date(p_doctor_id uuid, p_date date, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_id uuid;
begin
  perform public._require_admin();
  if p_date is null or not isfinite(p_date) or p_date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'Select today or a future clinic date.';
  end if;
  perform d.id from public.doctors d where d.id = p_doctor_id for update;
  if not found then raise exception 'Doctor not found.'; end if;
  select count(*) into v_count from public.appointments a where a.doctor_id = p_doctor_id
    and a.scheduled_time >= (p_date::timestamp at time zone 'Asia/Manila')
    and a.scheduled_time < ((p_date + 1)::timestamp at time zone 'Asia/Manila')
    and a.status not in ('cancelled','no_show');
  if v_count > 0 then return jsonb_build_object('success', false, 'conflict_count', v_count,
    'message', format('%s appointments conflict. Reschedule or cancel them explicitly before blocking this date.', v_count)); end if;
  insert into public.doctor_unavailable_dates (doctor_id, date, reason)
    values (p_doctor_id, p_date, nullif(btrim(p_reason), '')) returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id, 'conflict_count', 0);
end;
$$;

-- Link changes are deliberate admin/backend operations, not generic profile edits.
-- Keep existing own-row INSERT and patient CRUD RLS, but column-limit UPDATE.
revoke update on public.patients from public, anon, authenticated;
do $$
declare v_columns text;
begin
  select string_agg(quote_ident(attname), ', ') into v_columns from pg_attribute
    where attrelid = 'public.patients'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke update (%s) on public.patients from public, anon, authenticated', v_columns);
end $$;
grant update (full_name, date_of_birth, contact_number, address) on public.patients to authenticated;

-- Auth UUID is the sole automatic linking rule. No name matching. A profile
-- lock plus uq_patients_user serializes concurrent first-session requests.
create or replace function public.ensure_patient_identity(p_full_name text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_profile public.profiles%rowtype; v_patient public.patients%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception using errcode = '42501', message = 'Patient authentication required.'; end if;
  perform u.id from auth.users u where u.id = v_uid for update;
  if not found then raise exception 'Authenticated account not found.'; end if;
  select * into v_profile from public.profiles p where p.id = v_uid for update;
  if not found then
    if nullif(btrim(p_full_name), '') is null or length(btrim(p_full_name)) > 300 then
      raise exception 'A valid full name is required to complete your patient account.';
    end if;
    insert into public.profiles (id, full_name, role) values (v_uid, btrim(p_full_name), 'patient')
      on conflict (id) do nothing;
    select * into v_profile from public.profiles p where p.id = v_uid for update;
  end if;
  if v_profile.role is distinct from 'patient' then
    raise exception using errcode = '42501', message = 'This account is not a patient account. Staff must use /appointments/login.';
  end if;
  select * into v_patient from public.patients p where p.user_id = v_uid for update;
  if not found then
    insert into public.patients (user_id, full_name) values (v_uid, v_profile.full_name) returning * into v_patient;
  end if;
  return jsonb_build_object('profile', to_jsonb(v_profile), 'patient', to_jsonb(v_patient));
end;
$$;

-- Optional intentional clinic-record linking: an authorized administrator
-- verifies identity out of band and supplies exact profile + patient UUIDs.
-- Never merges/deletes another existing link or matches by name.
create or replace function public.admin_link_patient(p_user_id uuid, p_patient_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_link uuid; v_existing uuid; v_name text;
begin
  perform public._require_admin();
  perform u.id from auth.users u where u.id = p_user_id for update;
  if not found then raise exception 'Target must be an existing verified Auth account UUID.'; end if;
  select p.role into v_role from public.profiles p where p.id = p_user_id for update;
  if not found then
    select p.full_name into v_name from public.patients p where p.id = p_patient_id;
    if not found then raise exception 'Patient record not found.'; end if;
    -- Pre-link an administrator-verified Auth account before its first portal
    -- visit. The new profile receives patient only; metadata cannot assign role.
    insert into public.profiles (id, full_name, role) values (p_user_id, v_name, 'patient');
    v_role := 'patient';
  end if;
  if v_role is distinct from 'patient' then raise exception 'Target must be a patient account.'; end if;
  select p.id into v_existing from public.patients p where p.user_id = p_user_id;
  if v_existing is not null and v_existing is distinct from p_patient_id then
    raise exception 'This account already has a patient record. No records were merged or removed.';
  end if;
  select p.user_id into v_link from public.patients p where p.id = p_patient_id for update;
  if not found then raise exception 'Patient record not found.'; end if;
  if v_link is not null and v_link is distinct from p_user_id then raise exception 'Patient record is already linked to another account.'; end if;
  update public.patients set user_id = p_user_id where id = p_patient_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, old_value, new_value)
    values (auth.uid(), 'patient_link', 'patient', p_patient_id,
      jsonb_build_object('user_id', v_link), jsonb_build_object('user_id', p_user_id));
  return jsonb_build_object('success', true, 'id', p_patient_id);
end;
$$;

revoke all on function public._clinic_schedule_slots(uuid,date), public._assert_slot_bookable(uuid,timestamptz),
  public._guard_doctor_calendar_change(), public.get_available_appointment_slots(uuid,date),
  public.get_available_appointment_dates(uuid,date,integer),
  public.staff_block_doctor_date(uuid,date,text), public.ensure_patient_identity(text),
  public.admin_link_patient(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_available_appointment_slots(uuid,date),
  public.get_available_appointment_dates(uuid,date,integer),
  public.staff_block_doctor_date(uuid,date,text), public.ensure_patient_identity(text),
  public.admin_link_patient(uuid,uuid) to authenticated;
-- Phase 1 profile ACLs, appointment ACLs/RLS and uq_doctor_slot are unchanged.
-- END CANONICAL PHASE 2 AVAILABILITY
commit;

begin;
-- BEGIN CANONICAL PHASE 3 OPERATIONS
do $$ begin
  if to_regprocedure('public.get_available_appointment_slots(uuid,date)') is null
    or to_regprocedure('public.admin_link_patient(uuid,uuid)') is null then
    raise exception 'Phase 3 requires Phase 1 and Phase 2 first.';
  end if;
end $$;

-- Fail without printing personal data or modifying invalid existing records.
lock table public.profiles, public.patients, public.doctors, public.appointments,
  public.doctor_unavailable_dates, public.patient_visit_notes in share row exclusive mode;
create or replace function public._valid_clinic_text(p_text text, p_max integer, p_required boolean default false)
returns boolean language sql immutable set search_path = '' as $$
  select case when p_text is null then not p_required else
    length(btrim(p_text)) between case when p_required then 1 else 0 end and p_max
    and p_text !~ '[[:cntrl:]]' end;
$$;
create or replace function public._valid_clinic_contact(p_text text)
returns boolean language sql immutable set search_path = '' as $$
  select p_text is null or (p_text ~ '^\+?[0-9][0-9 ()-]{5,24}$'
    and length(regexp_replace(p_text, '[^0-9]', '', 'g')) between 7 and 15);
$$;
do $$ declare n bigint; begin
  select count(*) into n from public.profiles where not public._valid_clinic_text(full_name,300,true)
    or not public._valid_clinic_text(device_label,100);
  if n > 0 then raise exception 'Phase 3 aborted: % invalid profile row(s). Review privately; no cleanup performed.',n; end if;
  select count(*) into n from public.doctors where not public._valid_clinic_text(full_name,200,true)
    or not public._valid_clinic_text(specialty,120) or (specialty is not null and btrim(specialty)='');
  if n > 0 then raise exception 'Phase 3 aborted: % invalid doctor row(s). Review privately; no cleanup performed.',n; end if;
  select count(*) into n from public.patients where not public._valid_clinic_text(full_name,300,true)
    or not public._valid_clinic_contact(contact_number) or not public._valid_clinic_text(address,500)
    or (date_of_birth is not null and (not isfinite(date_of_birth) or date_of_birth < date '1900-01-01'
      or date_of_birth > (now() at time zone 'Asia/Manila')::date));
  if n > 0 then raise exception 'Phase 3 aborted: % invalid patient demographic row(s). Review privately; no cleanup performed.',n; end if;
  select count(*) into n from public.appointments where not public._valid_clinic_text(room,100) or length(coalesce(reason,''))>2000;
  if n > 0 then raise exception 'Phase 3 aborted: % invalid appointment text row(s). Review privately; no cleanup performed.',n; end if;
  select count(*) into n from public.doctor_unavailable_dates where length(coalesce(reason,''))>500;
  if n > 0 then raise exception 'Phase 3 aborted: % invalid unavailable-date reason row(s). Review privately; no cleanup performed.',n; end if;
  select count(*) into n from public.patient_visit_notes note_row where length(btrim(note_row.note)) not between 1 and 3000
    or (note_row.appointment_id is not null and not exists(select 1 from public.appointments a where a.id=note_row.appointment_id and a.patient_id=note_row.patient_id));
  if n > 0 then raise exception 'Phase 3 aborted: % invalid visit-note row(s). Review privately; no cleanup performed.',n; end if;
end $$;
create or replace function public._validate_clinic_form()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='profiles' then
    if not public._valid_clinic_text(new.full_name,300,true) or not public._valid_clinic_text(new.device_label,100) then
      raise exception 'Profile name is required (up to 300 characters); device label is limited to 100 characters. Control characters are not allowed.'; end if;
    new.full_name:=btrim(new.full_name);
  elsif tg_table_name='doctors' then
    if not public._valid_clinic_text(new.full_name,200,true) or not public._valid_clinic_text(new.specialty,120)
      or (new.specialty is not null and btrim(new.specialty)='') then
      raise exception 'Doctor name is required (up to 200 characters); specialty must be nonblank or null (up to 120 characters).'; end if;
    new.full_name:=btrim(new.full_name); new.specialty:=nullif(btrim(new.specialty),'');
  elsif tg_table_name='patients' then
    if not public._valid_clinic_text(new.full_name,300,true) or not public._valid_clinic_text(new.address,500)
      or not public._valid_clinic_contact(new.contact_number) then
      raise exception 'Enter a nonblank patient name (up to 300), address up to 500, and a valid 7–15 digit contact number.'; end if;
    if new.date_of_birth is not null and (not isfinite(new.date_of_birth) or new.date_of_birth < date '1900-01-01'
      or new.date_of_birth > (now() at time zone 'Asia/Manila')::date) then
      raise exception 'Date of birth must be a valid date from 1900 through today in Asia/Manila.'; end if;
    new.full_name:=btrim(new.full_name); new.address:=nullif(btrim(new.address),'');
  elsif tg_table_name='doctor_unavailable_dates' then
    if length(coalesce(new.reason,''))>500 then raise exception 'Unavailable-date reason is limited to 500 characters.'; end if;
  elsif tg_table_name='appointments' then
    if not public._valid_clinic_text(new.room,100) or length(coalesce(new.reason,''))>2000 then
      raise exception 'Room is limited to 100 characters and appointment reason to 2000 characters.'; end if;
  elsif tg_table_name='patient_visit_notes' then
    if length(btrim(new.note)) not between 1 and 3000 then raise exception 'Visit note must contain 1–3000 characters.'; end if;
    if new.appointment_id is not null and not exists(select 1 from public.appointments a where a.id=new.appointment_id and a.patient_id=new.patient_id) then
      raise exception 'Visit note must reference an appointment belonging to the selected patient.'; end if;
    if tg_op='INSERT' and auth.uid() is not null then new.created_by:=auth.uid(); end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['profiles','patients','doctors','doctor_unavailable_dates','appointments','patient_visit_notes'] loop
    execute format('drop trigger if exists phase3_validate_form on public.%I',t);
    execute format('create trigger phase3_validate_form before insert or update on public.%I for each row execute function public._validate_clinic_form()',t);
  end loop;
end $$;

-- Read-only authorization uses the statement snapshot, without actor row locks.
-- Protected mutations must continue using the Phase 1 _require_admin() guard.
create or replace function public._require_admin_readonly()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin') then
    raise exception using errcode='42501',message='Administrator authorization required.';
  end if;
end $$;
-- Private helper: only the SECURITY DEFINER entry points invoke it.
revoke all on function public._require_admin_readonly() from public,anon,authenticated;

create or replace function public.admin_patient_duplicate_count(p_name text,p_dob date default null,p_contact text default null)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare n bigint; begin
  perform public._require_admin_readonly();
  if not public._valid_clinic_text(p_name,300,true) or not public._valid_clinic_contact(nullif(btrim(p_contact),'')) then raise exception 'Invalid duplicate-search input.'; end if;
  select count(*) into n from public.patients p where lower(btrim(p.full_name))=lower(btrim(p_name))
    and ((p_dob is not null and p.date_of_birth=p_dob) or (nullif(btrim(p_contact),'') is not null
      and regexp_replace(p.contact_number,'[^0-9]','','g')=regexp_replace(p_contact,'[^0-9]','','g')));
  return n;
end $$;
-- Doctors are retained; deactivation is the supported removal operation.
revoke delete on public.doctors, public.patients from public, anon, authenticated;
-- Retain doctor names on an owning patient's history after deactivation.
drop policy if exists patient_read_doctors on public.doctors;
create policy patient_read_doctors on public.doctors for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='patient')
  and (is_active or exists(select 1 from public.appointments a where a.doctor_id=doctors.id and a.patient_id=public.my_patient_id())));

create or replace function public.patient_save_profile(p_full_name text, p_date_of_birth date default null,
  p_contact_number text default null, p_address text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; begin
  v_patient:=public._require_patient();
  update public.patients set full_name=p_full_name,date_of_birth=p_date_of_birth,
    contact_number=nullif(btrim(p_contact_number),''),address=nullif(btrim(p_address),'') where id=v_patient;
  update public.profiles set full_name=p_full_name where id=auth.uid();
  return jsonb_build_object('success',true,'id',v_patient);
end $$;

-- Version state is separate: no new appointment columns or historical rewrites.
create table if not exists public.appointment_notification_versions (
  appointment_id uuid primary key references public.appointments(id) on delete restrict,
  revision bigint not null default 1 check(revision>0)
);
create table if not exists public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  notification_type text not null check(notification_type in ('confirmation','reschedule','cancellation','reminder')),
  channel text not null default 'sms' check(channel='sms'),
  revision bigint not null check(revision>0),
  scheduled_time timestamptz not null,
  status text not null default 'pending' check(status in ('pending','processing','accepted','failed','unknown','stubbed','superseded')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 3),
  provider text check(provider is null or provider in ('twilio','none')),
  provider_reference text check(length(provider_reference)<=128),
  error_summary text check(error_summary is null or error_summary in ('provider_rejected','rate_limited','transport_unknown','lease_expired','not_configured','no_destination','invalid_destination')),
  retry_at timestamptz,
  lease_token uuid,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  delivery_status text not null default 'not_verified' check(delivery_status in ('not_verified','queued','sent','delivered','failed')),
  unique(appointment_id,notification_type,revision,channel)
);
create index if not exists phase3_notifications_due on public.notification_attempts(status,retry_at,created_at);
create unique index if not exists phase3_notification_provider_reference on public.notification_attempts(provider,provider_reference) where provider_reference is not null;
alter table public.appointment_notification_versions enable row level security;
alter table public.notification_attempts enable row level security;
revoke all on public.appointment_notification_versions, public.notification_attempts from public,anon,authenticated;
grant select on public.notification_attempts to authenticated;
grant all on public.appointment_notification_versions, public.notification_attempts to service_role;
drop policy if exists notifications_admin_read on public.notification_attempts;
create policy notifications_admin_read on public.notification_attempts for select to authenticated using(public.is_admin());
-- No message bodies, names, phone numbers, reasons, or secrets are stored here.
insert into public.appointment_notification_versions(appointment_id) select id from public.appointments on conflict do nothing;

create or replace function public._enqueue_appointment_notice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_revision bigint; v_type text; begin
  if tg_op='INSERT' then
    insert into public.appointment_notification_versions(appointment_id) values(new.id) on conflict do nothing;
    if new.status='scheduled' then v_type:='confirmation'; end if;
  elsif new.scheduled_time is distinct from old.scheduled_time or new.doctor_id is distinct from old.doctor_id then
    update public.appointment_notification_versions set revision=revision+1 where appointment_id=new.id;
    v_type:='reschedule';
  elsif new.status='cancelled' and old.status<>'cancelled' then
    update public.appointment_notification_versions set revision=revision+1 where appointment_id=new.id;
    v_type:='cancellation';
  elsif new.status='scheduled' and old.status='pending' then v_type:='confirmation';
  end if;
  if v_type is not null then
    select revision into v_revision from public.appointment_notification_versions where appointment_id=new.id;
    update public.notification_attempts set status='superseded',retry_at=null
      where appointment_id=new.id and revision<>v_revision and status in ('pending','failed');
    insert into public.notification_attempts(appointment_id,patient_id,notification_type,revision,scheduled_time)
      values(new.id,new.patient_id,v_type,v_revision,new.scheduled_time) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists phase3_enqueue_notification on public.appointments;
create trigger phase3_enqueue_notification after insert or update on public.appointments
  for each row execute function public._enqueue_appointment_notice();

create or replace function public.request_appointment_notification(p_appointment_id uuid,p_type text default 'confirmation')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_patient uuid; v_id uuid; begin
  if p_type not in ('confirmation','reschedule','cancellation') then raise exception 'Invalid notification type.'; end if;
  if public.is_admin() then perform public._require_admin(); else v_patient:=public._require_patient(); end if;
  if not exists(select 1 from public.appointments a where a.id=p_appointment_id and (v_patient is null or a.patient_id=v_patient)) then
    raise exception using errcode='42501',message='Appointment notification is not authorized.'; end if;
  select n.id into v_id from public.notification_attempts n
    join public.appointment_notification_versions v using(appointment_id)
    where n.appointment_id=p_appointment_id and n.notification_type=p_type and n.revision=v.revision;
  return v_id;
end $$;

create or replace function public.queue_due_appointment_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare v_day date; n integer; begin
  if p_now is null or not isfinite(p_now) then raise exception 'Invalid reminder clock.'; end if;
  v_day:=(p_now at time zone 'Asia/Manila')::date+1;
  if (p_now at time zone 'Asia/Manila')::time < time '07:00' then return 0; end if;
  insert into public.notification_attempts(appointment_id,patient_id,notification_type,revision,scheduled_time)
    select a.id,a.patient_id,'reminder',v.revision,a.scheduled_time from public.appointments a
    join public.appointment_notification_versions v on v.appointment_id=a.id
    where a.status='scheduled' and a.scheduled_time>p_now
      and a.scheduled_time >= (v_day::timestamp at time zone 'Asia/Manila')
      and a.scheduled_time < ((v_day+1)::timestamp at time zone 'Asia/Manila') on conflict do nothing;
  get diagnostics n=row_count; return n;
end $$;

-- Atomic claims, SKIP LOCKED and leases prevent concurrent worker duplication.
-- Expired uncertain sends become unknown, NEVER automatically resent.
create or replace function public.claim_appointment_notifications(p_event_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n public.notification_attempts%rowtype; a public.appointments%rowtype; v bigint;
  token uuid; out_rows jsonb:='[]'; phone text; begin
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'Notification batch must be 1–50.'; end if;
  update public.notification_attempts set status='unknown',error_summary='lease_expired',retry_at=null
    where status='processing' and last_attempt_at<now()-interval '5 minutes';
  for n in select * from public.notification_attempts where (p_event_id is null or id=p_event_id)
    and (status='pending' or (status='failed' and retry_at<=now())) and attempt_count<3
    order by created_at,id limit p_limit loop
    select * into a from public.appointments where id=n.appointment_id for share;
    -- Same lock order as appointment mutation triggers: appointment, then ledger.
    select * into n from public.notification_attempts e where e.id=n.id
      and (e.status='pending' or (e.status='failed' and e.retry_at<=now())) and e.attempt_count<3
      for update skip locked;
    if not found then continue; end if;
    select revision into v from public.appointment_notification_versions where appointment_id=n.appointment_id;
    if v<>n.revision or a.scheduled_time<>n.scheduled_time
      or (n.notification_type='cancellation' and a.status<>'cancelled')
      or (n.notification_type<>'cancellation' and a.status<>'scheduled')
      or (n.notification_type='reminder' and a.scheduled_time<=now()) then
      update public.notification_attempts set status='superseded',retry_at=null where id=n.id; continue;
    end if;
    token:=gen_random_uuid();
    update public.notification_attempts set status='processing',attempt_count=attempt_count+1,last_attempt_at=now(),
      lease_token=token,retry_at=null where id=n.id;
    select contact_number into phone from public.patients where id=a.patient_id;
    out_rows:=out_rows||jsonb_build_array(jsonb_build_object('event_id',n.id,'lease_token',token,
      'notification_type',n.notification_type,'scheduled_time',a.scheduled_time,'contact_number',phone));
  end loop;
  return out_rows;
end $$;
create or replace function public.finish_appointment_notification(p_event_id uuid,p_lease_token uuid,
  p_status text,p_provider text default null,p_reference text default null,p_error text default null,p_retry boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('accepted','failed','unknown','stubbed') then raise exception 'Invalid notification result.'; end if;
  update public.notification_attempts set status=p_status,provider=p_provider,provider_reference=p_reference,
    error_summary=p_error,accepted_at=case when p_status='accepted' then now() else null end,
    retry_at=case when p_status='failed' and p_retry and attempt_count<3 then now()+make_interval(mins=>5*attempt_count) else null end,
    lease_token=null where id=p_event_id and lease_token=p_lease_token and status='processing';
  return found;
end $$;
create or replace function public.notification_result(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status',status,'provider',provider,'accepted',status='accepted','stubbed',status='stubbed',
    'error',error_summary,'delivery',delivery_status) from public.notification_attempts where id=p_event_id;
$$;
create or replace function public.record_notification_delivery(p_reference text,p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('queued','sent','delivered','failed') then raise exception 'Invalid delivery status.'; end if;
  update public.notification_attempts set delivery_status=p_status,
    delivered_at=case when p_status='delivered' then coalesce(delivered_at,now()) else delivered_at end
    where provider='twilio' and provider_reference=p_reference and status='accepted'
      and (delivery_status not in ('delivered','failed') or delivery_status=p_status);
  if found then return true; end if;
  -- A delayed earlier callback must not downgrade a terminal delivery state.
  return exists(select 1 from public.notification_attempts where provider='twilio' and provider_reference=p_reference and status='accepted' and delivery_status in ('delivered','failed'));
end $$;

-- Complete server aggregation: PostgREST row caps cannot truncate this JSON.
create or replace function public.staff_appointment_report(p_from date,p_to date,p_doctor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; begin
  perform public._require_admin_readonly();
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>365 then
    raise exception 'Choose a valid inclusive report range of at most 366 clinic days.'; end if;
  with visits as (
    select a.*,d.full_name doctor_name,p.full_name patient_name,p.contact_number from public.appointments a
    join public.doctors d on d.id=a.doctor_id join public.patients p on p.id=a.patient_id
    where a.scheduled_time >= (p_from::timestamp at time zone 'Asia/Manila')
      and a.scheduled_time < ((p_to+1)::timestamp at time zone 'Asia/Manila')
  ), scoped as (select * from visits where p_doctor_id is null or doctor_id=p_doctor_id),
  per_doctor as (select doctor_id id,max(doctor_name) name,count(*) total,
    count(*) filter(where status='completed') completed,count(*) filter(where status='cancelled') cancelled,
    count(*) filter(where status='no_show') "noShow",count(*) filter(where source='walk_in') "walkIn"
    from scoped group by doctor_id),
  per_day as (select (scheduled_time at time zone 'Asia/Manila')::date as clinic_day,count(*) as count from scoped group by 1),
  per_patient as (select patient_id id,max(patient_name) name,max(contact_number) contact,count(*) total,
    count(*) filter(where status='no_show') "noShow" from scoped group by patient_id)
  select jsonb_build_object('total',(select count(*) from scoped),
    'noShows',(select count(*) from scoped where status='no_show'),
    'cancelled',(select count(*) from scoped where status='cancelled'),
    'walkIns',(select count(*) from scoped where source='walk_in'),
    'doctors',coalesce((select jsonb_agg(x order by name,id) from (select distinct doctor_id id,doctor_name name from visits)x),'[]'),
    'perDoctor',coalesce((select jsonb_agg(x order by total desc,id) from per_doctor x),'[]'),
    'perDay',coalesce((select jsonb_object_agg(clinic_day,count) from per_day),'{}'),
    'noShowPatients',coalesce((select jsonb_agg(x order by "noShow" desc,id) from per_patient x where "noShow">=2),'[]')) into result;
  return result;
end $$;
create or replace function public.staff_report_audit(p_from date,p_to date,p_action text default null,p_offset integer default 0,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; begin
  perform public._require_admin_readonly();
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>365
    or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid audit report range or page.'; end if;
  with logs as (select id,action,entity,created_at from public.audit_log
    where created_at >= (p_from::timestamp at time zone 'Asia/Manila') and created_at < ((p_to+1)::timestamp at time zone 'Asia/Manila')),
    scoped as (select * from logs where p_action is null or action=p_action)
  select jsonb_build_object('total',(select count(*) from scoped),'actions',coalesce((select jsonb_agg(action order by action) from (select distinct action from logs)x),'[]'),
    'rows',coalesce((select jsonb_agg(x order by created_at desc,id) from (select * from scoped order by created_at desc,id offset p_offset limit p_limit)x),'[]')) into result;
  return result;
end $$;

revoke all on function public._valid_clinic_text(text,integer,boolean),public._valid_clinic_contact(text),public._validate_clinic_form(),
  public._enqueue_appointment_notice(),public.patient_save_profile(text,date,text,text),
  public.admin_patient_duplicate_count(text,date,text),
  public.request_appointment_notification(uuid,text),public.queue_due_appointment_reminders(timestamptz),
  public.claim_appointment_notifications(uuid,integer),public.finish_appointment_notification(uuid,uuid,text,text,text,text,boolean),
  public.notification_result(uuid),public.record_notification_delivery(text,text),public.staff_appointment_report(date,date,uuid),public.staff_report_audit(date,date,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.patient_save_profile(text,date,text,text),public.request_appointment_notification(uuid,text),
  public.admin_patient_duplicate_count(text,date,text),
  public.staff_appointment_report(date,date,uuid),public.staff_report_audit(date,date,text,integer,integer) to authenticated;
grant execute on function public.queue_due_appointment_reminders(timestamptz),public.claim_appointment_notifications(uuid,integer),
  public.finish_appointment_notification(uuid,uuid,text,text,text,text,boolean),public.notification_result(uuid),public.record_notification_delivery(text,text) to service_role;
-- Validation trigger helpers intentionally remain private. Constraints and P1/P2 ACLs remain unchanged.
-- END CANONICAL PHASE 3 OPERATIONS
commit;

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
