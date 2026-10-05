-- Phase 2; review and apply manually AFTER fix_phase1_security.sql.
-- No reset, seed, row deletion, automatic reconciliation or production rollout.
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
