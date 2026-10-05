-- Phase 1: apply manually as the database owner after reviewing/backing up.
-- Existing post-cleanup schema required. No rows are deleted or rewritten.
-- Pre-cleanup installations must first use migrate_patient_booking.sql.
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
