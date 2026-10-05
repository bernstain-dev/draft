-- MANUAL, ONE-PROJECT TEST-DATA RECONCILIATION ONLY. NOT A GENERAL MIGRATION.
-- User confirmed test data and Monday 08:00–17:00 / 30-minute slots.
-- Run this ENTIRE file in that project's SQL Editor BEFORE retrying Phase 2.
-- Never run against real patient data or another project. No hosted execution
-- is performed by repository tools. Only the three exact redundant rows below
-- are archived privately and deleted; appointments/patients/doctors untouched.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
lock table public.doctor_schedules in share row exclusive mode;

do $$
declare
  v_doctor constant uuid := '58b6b969-6c23-48e2-a53a-86a3a21b5f46';
  v_keeper constant uuid := 'a843e54b-6e38-4c87-bfa8-23d5d3a94507';
  v_remove constant uuid[] := array[
    '0ba71514-0449-4a29-a536-cfe95022fc64'::uuid,
    '434ce046-33ac-4b7a-a1b2-f84933cfd0f1'::uuid,
    '6427b941-b05e-4c43-8336-45f9983cebe7'::uuid
  ];
  v_count integer; v_matching integer; v_deleted integer;
begin
  -- Guard exact identity/hours/duration, including the keeper, not just UUIDs.
  if not exists(select 1 from public.doctor_schedules where id=v_keeper
    and doctor_id=v_doctor and day_of_week=1 and start_time=time '08:00'
    and end_time=time '17:00' and slot_duration_minutes=30) then
    raise exception 'Reconciliation aborted: expected Monday 08:00–17:00 keeper does not match. No records changed.';
  end if;
  select count(*) into v_count from public.doctor_schedules where id=any(v_remove);
  if v_count=0 then
    raise notice 'Redundant target rows are already absent; expected keeper remains. No rows deleted.';
    return;
  end if;
  select count(*) into v_matching from public.doctor_schedules s join (values
    (v_remove[1],time '09:00'),(v_remove[2],time '10:00'),(v_remove[3],time '11:00')
  ) expected(id,start_time) on expected.id=s.id
    where s.doctor_id=v_doctor and s.day_of_week=1 and s.start_time=expected.start_time
      and s.end_time=time '17:00' and s.slot_duration_minutes=30;
  if v_count<>3 or v_matching<>3
    or (select count(*) from public.doctor_schedules where doctor_id=v_doctor and day_of_week=1)<>4 then
    raise exception 'Reconciliation aborted: target schedules changed or extra Monday rows exist. No records changed.';
  end if;
  -- Stop rather than cascade or run unreviewed trigger/rule side effects.
  if exists(select 1 from pg_catalog.pg_constraint where contype='f'
    and confrelid='public.doctor_schedules'::regclass) then
    raise exception 'Reconciliation aborted: other tables reference schedules; review dependencies first.';
  end if;
  if exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.doctor_schedules'::regclass
    and not tgisinternal and tgenabled<>'D' and (tgtype::integer & 8)<>0)
    or exists(select 1 from pg_catalog.pg_rewrite where ev_class='public.doctor_schedules'::regclass and ev_type='4') then
    raise exception 'Reconciliation aborted: DELETE triggers/rules require private review first.';
  end if;

  -- Durable original schedule recovery copy; no patient/contact data involved.
  -- Database owner only. No browser/public/service-role privileges or policies.
  create schema if not exists medicappointment_maintenance;
  revoke all on schema medicappointment_maintenance from public,anon,authenticated,service_role;
  create table if not exists medicappointment_maintenance.schedule_reconciliation_archive (
    schedule_id uuid primary key,
    original_row jsonb not null,
    operation text not null,
    archived_at timestamptz not null default now()
  );
  alter table medicappointment_maintenance.schedule_reconciliation_archive enable row level security;
  revoke all on table medicappointment_maintenance.schedule_reconciliation_archive from public,anon,authenticated,service_role;
  insert into medicappointment_maintenance.schedule_reconciliation_archive(schedule_id,original_row,operation)
    select id,to_jsonb(s),'confirmed-test-monday-0800-1700' from public.doctor_schedules s
    where id=any(v_remove) on conflict(schedule_id) do nothing;
  if exists(select 1 from public.doctor_schedules s
    left join medicappointment_maintenance.schedule_reconciliation_archive b on b.schedule_id=s.id
    where s.id=any(v_remove) and (b.schedule_id is null or b.original_row is distinct from to_jsonb(s)
      or b.operation<>'confirmed-test-monday-0800-1700')) then
    raise exception 'Reconciliation aborted: archive conflict. No records changed.';
  end if;
  delete from public.doctor_schedules where id=any(v_remove);
  get diagnostics v_deleted=row_count;
  if v_deleted<>3 then raise exception 'Unexpected delete count; reconciliation rolled back.'; end if;
  raise notice 'Archived and removed exactly 3 redundant test schedules; retained Monday 08:00–17:00 keeper. Appointments untouched.';
end $$;

select id,doctor_id,day_of_week,start_time,end_time,slot_duration_minutes
from public.doctor_schedules
where doctor_id='58b6b969-6c23-48e2-a53a-86a3a21b5f46'::uuid and day_of_week=1
order by start_time;
commit;
