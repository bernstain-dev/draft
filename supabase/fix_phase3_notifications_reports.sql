-- Incremental upgrade AFTER fix_phase1_security.sql and fix_phase2_booking_availability.sql.
-- No hosted execution, seeding, cleanup, or credential literals are required.
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
