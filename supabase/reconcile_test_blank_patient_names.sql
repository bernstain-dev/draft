-- MANUAL correction for the user-confirmed TEST-DATA project only.
-- Expected diagnostic: exactly 14 blank names; no other invalid demographics.
-- Assigns explicitly synthetic labels; does NOT recover actual patient names.
-- Run ENTIRE file before retrying Phase 3. Never use on real patient data.
-- No records are deleted, merged or linked; existing identities/history remain.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
lock table public.patients in share row exclusive mode;

do $$
declare v_blank integer; v_changed integer;
begin
  select count(*) into v_blank from public.patients where btrim(full_name)='';
  if v_blank=0 then
    raise notice 'No blank names remain; no patient names changed.';
    return;
  end if;
  if v_blank<>14 then
    raise exception 'Test-name correction aborted: expected exactly 14 blank names, found %. No records changed.',v_blank;
  end if;
  if exists(select 1 from public.patients where full_name is null
    or length(btrim(full_name))>300 or full_name ~ '[[:cntrl:]]'
    or (contact_number is not null and not (contact_number ~ '^\+?[0-9][0-9 ()-]{5,24}$'
      and length(regexp_replace(contact_number,'[^0-9]','','g')) between 7 and 15))
    or (address is not null and (length(btrim(address))>500 or address ~ '[[:cntrl:]]'))
    or (date_of_birth is not null and (not isfinite(date_of_birth) or date_of_birth<date '1900-01-01'
      or date_of_birth>(now() at time zone 'Asia/Manila')::date))) then
    raise exception 'Test-name correction aborted: other invalid demographics require private review. No records changed.';
  end if;
  -- Do not disable triggers or allow unreviewed update side effects.
  if exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.patients'::regclass
    and not tgisinternal and tgenabled<>'D' and (tgtype::integer & 16)<>0)
    or exists(select 1 from pg_catalog.pg_rewrite where ev_class='public.patients'::regclass and ev_type='2') then
    raise exception 'Test-name correction aborted: patient UPDATE triggers/rules require private review first.';
  end if;
  if exists(select 1 from public.patients blank_row join public.patients named_row
    on lower(btrim(named_row.full_name))=lower('TEST PATIENT '||blank_row.id::text)
    where btrim(blank_row.full_name)='') then
    raise exception 'Test-name correction aborted: a generated label already exists. No records changed.';
  end if;

  -- Private backup includes IDs and blank names only, no contact/DOB/address.
  create schema if not exists medicappointment_maintenance;
  revoke all on schema medicappointment_maintenance from public,anon,authenticated,service_role;
  create table if not exists medicappointment_maintenance.blank_patient_name_archive (
    patient_id uuid primary key,
    original_name text not null,
    replacement_name text not null,
    operation text not null,
    archived_at timestamptz not null default now()
  );
  alter table medicappointment_maintenance.blank_patient_name_archive enable row level security;
  revoke all on table medicappointment_maintenance.blank_patient_name_archive from public,anon,authenticated,service_role;
  insert into medicappointment_maintenance.blank_patient_name_archive(patient_id,original_name,replacement_name,operation)
    select id,full_name,'TEST PATIENT '||id::text,'confirmed-test-14-blank-names'
    from public.patients where btrim(full_name)='' on conflict(patient_id) do nothing;
  if exists(select 1 from public.patients p
    left join medicappointment_maintenance.blank_patient_name_archive b on b.patient_id=p.id
    where btrim(p.full_name)='' and (b.patient_id is null or b.original_name is distinct from p.full_name
      or b.replacement_name is distinct from 'TEST PATIENT '||p.id::text
      or b.operation<>'confirmed-test-14-blank-names')) then
    raise exception 'Test-name correction aborted: archive conflict. No records changed.';
  end if;
  update public.patients p set full_name=b.replacement_name
    from medicappointment_maintenance.blank_patient_name_archive b
    where p.id=b.patient_id and b.operation='confirmed-test-14-blank-names'
      and btrim(p.full_name)='' and p.full_name=b.original_name;
  get diagnostics v_changed=row_count;
  if v_changed<>14 then raise exception 'Unexpected update count; test-name correction rolled back.'; end if;
  raise notice 'Exactly 14 blank names replaced with TEST PATIENT labels. IDs, links and appointment history unchanged.';
end $$;

-- Counts only; do not display demographics or synthetic identity mappings.
select count(*) filter(where btrim(full_name)='') as remaining_blank_patient_names
from public.patients;
commit;
