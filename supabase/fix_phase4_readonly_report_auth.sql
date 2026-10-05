-- MedicAppointment Phase 4: read-only admin report authorization.
-- Existing Phase 1/2/3 database ONLY; review and apply as the database owner.
-- No data, roles, RLS, history, scheduling or notification operations are changed.
-- Keep mutation authorization (_require_admin and its actor lock) intact.
-- Report functions stay STABLE; duplicate counting is also genuinely read-only.
-- Safe to repeat. Do not use schema.sql/full.sql/reset for a hosted upgrade.

begin;

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

revoke all on function public.staff_appointment_report(date,date,uuid),
  public.staff_report_audit(date,date,text,integer,integer),
  public.admin_patient_duplicate_count(text,date,text) from public,anon,authenticated;
grant execute on function public.staff_appointment_report(date,date,uuid),
  public.staff_report_audit(date,date,text,integer,integer),
  public.admin_patient_duplicate_count(text,date,text) to authenticated;

commit;
