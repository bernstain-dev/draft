-- MedicAppointment: complete demo data, including the TWO demo Auth accounts.
-- Run this entire file in Supabase SQL Editor after installing schema.sql.
-- For schema + these records in one file, run full_demo.sql instead.
-- Edit v_admin_email and v_patient_email below if your demo accounts differ.
-- Existing passwords, roles, patient identity links and records are preserved.
-- Missing Auth accounts and their email identities/profiles are created.
-- NEW accounts only: vacunawa@gmail.com / admin123; patient@gmail.com / patient123.
-- Existing accounts keep their passwords; incorrect existing profile roles abort.
-- All seeded dates use Asia/Manila and are relative to the FIRST successful run.
-- Re-running adds no duplicate records and does not reset demo interactions.
-- All demo notifications are terminal, unsent samples; this file sends no SMS.
-- Appearance is browser-local; passwords remain in Supabase Auth, not demo tables.

-- The complete import is ONE atomic DO statement with no temporary tables.
-- Paste this entire file into SQL Editor and run all of it.

do $medicappointment_demo$
declare
  v_admin_email text := 'vacunawa@gmail.com';
  v_patient_email text := 'patient@gmail.com';
  v_base_date date := (now() at time zone 'Asia/Manila')::date;
  v_new_featured uuid[] := array[]::uuid[];
  v_new_history uuid[] := array[]::uuid[];
  v_new_appointments uuid[] := array[]::uuid[];
  v_inventory jsonb;
  v_admin uuid; v_user uuid; v_patient uuid; v_name text;
  v_account record; v_id uuid;
  v_admin_created boolean := false; v_patient_created boolean := false;
begin
  perform set_config('search_path','public,extensions',true);
  perform pg_advisory_xact_lock(741903,1003);
  if to_regclass('public.notification_attempts') is null
    or to_regprocedure('public.staff_appointment_report(date,date,uuid)') is null then
    raise exception 'Install the current supabase/schema.sql (including Phase 1-3) before demo_data.sql.';
  end if;
  if lower(v_admin_email)=lower(v_patient_email) then
    raise exception 'Admin and patient must have separate email addresses.';
  end if;

  -- SQL-only demo provisioning: use the current Supabase Auth user/identity shape.
  -- Token strings must be empty strings, not NULL (Auth unmarshals them as strings).
  -- Sources: https://github.com/supabase/auth/blob/master/internal/models/user.go
  -- https://github.com/supabase/auth/blob/master/migrations/20231117164230_add_id_pkey_identities.up.sql
  for v_account in
    select v_admin_email as email,'admin123' as password,'RHU Admin' as name,'admin' as role
    union all
    select v_patient_email,'patient123','Maria Santos','patient'
  loop
    v_id := null;
    select u.id into v_id from auth.users u where lower(u.email)=lower(v_account.email);
    if v_id is null then
      v_id := gen_random_uuid();
      insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
        raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
        confirmation_token,recovery_token,email_change_token_new,email_change_token_current,
        email_change,phone_change,phone_change_token,reauthentication_token,is_sso_user,is_anonymous)
      values('00000000-0000-0000-0000-000000000000',v_id,'authenticated','authenticated',
        lower(v_account.email),crypt(v_account.password,gen_salt('bf',10)),now(),
        jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
        jsonb_build_object('full_name',v_account.name,'email_verified',true,'phone_verified',false),now(),now(),
        '','','','','','','','',false,false);

      insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at)
      values(gen_random_uuid(),v_id,v_id::text,
        jsonb_build_object('sub',v_id::text,'email',lower(v_account.email),'email_verified',true,'phone_verified',false),
        'email',now(),now());
      if v_account.role='admin' then v_admin_created := true;
      else v_patient_created := true; end if;
    end if;
    if v_account.role='admin' then v_admin := v_id; else v_user := v_id; end if;
  end loop;
  if v_admin = v_user then raise exception 'Admin and patient must be separate Auth users.'; end if;

  insert into public.profiles(id,full_name,role)
  values (v_admin,'RHU Admin','admin'),(v_user,'Maria Santos','patient')
  on conflict (id) do nothing;
  -- Some projects auto-create patient profiles on Auth INSERT. Set the intended
  -- role only for an account created by THIS transaction; never promote an existing user.
  if v_admin_created then update public.profiles set role='admin' where id=v_admin and role<>'admin'; end if;
  if v_patient_created then update public.profiles set role='patient' where id=v_user and role<>'patient'; end if;
  if not exists(select 1 from public.profiles where id=v_admin and role='admin')
    or not exists(select 1 from public.profiles where id=v_user and role='patient') then
    raise exception 'The existing selected accounts must have admin and patient roles respectively. No existing role was changed.';
  end if;

  -- Resolve identity by Auth UUID, never by a matching patient name.
  select id into v_patient from public.patients where user_id=v_user;
  if v_patient is null then
    v_patient := ('d3e00000-0004-4000-8000-'||lpad((1)::text,12,'0'))::uuid;
    select full_name into v_name from public.profiles where id=v_user;
    insert into public.patients(id,user_id,full_name,date_of_birth,contact_number,address)
    values(v_patient,v_user,v_name,date '1990-07-22',null,'Paringao, Bauang, La Union');
  end if;

-- 1. Doctor directory: nine active doctors and one inactive historical doctor.
insert into public.doctors(id,full_name,specialty,is_active)
select ('d3e00000-0001-4000-8000-'||lpad((n)::text,12,'0'))::uuid, name, specialty, active from (values
  (1,'Dr. Elena Navarro','General medicine',true),
  (2,'Dr. Miguel Aquino','Pediatrics',true),
  (3,'Dr. Isabel Mercado','OB-Gyne',true),
  (4,'Dr. Luis Santiago','Dentistry',true),
  (5,'Dr. Clara Alonzo','Cardiology',true),
  (6,'Dr. Rafael Flores','Dermatology',true),
  (7,'Dr. Beatriz Salcedo','Ophthalmology',true),
  (8,'Dr. Andres Rivera','ENT',true),
  (9,'Dr. Teresa Valdez','Internal Medicine',true),
  (10,'Dr. Emilio Castillo','Orthopedics',false)
) as d(n,name,specialty,active)
on conflict(id) do nothing;

-- 2. Seventy non-overlapping weekly schedules, 08:00-17:00, 30-minute slots.
-- The inactive doctor retains a calendar but cannot receive new bookings.
insert into public.doctor_schedules(id,doctor_id,day_of_week,start_time,end_time,slot_duration_minutes)
select ('d3e00000-0002-4000-8000-'||lpad(((d-1)*7+dow+1)::text,12,'0'))::uuid,('d3e00000-0001-4000-8000-'||lpad((d)::text,12,'0'))::uuid,dow,time '08:00',time '17:00',30
from generate_series(1,10) d cross join generate_series(0,6) dow
on conflict(id) do nothing;

-- 3. Date exceptions: none overlaps an appointment seeded below.
insert into public.doctor_unavailable_dates(id,doctor_id,date,reason)
select ('d3e00000-0003-4000-8000-'||lpad((n)::text,12,'0'))::uuid,('d3e00000-0001-4000-8000-'||lpad((doctor)::text,12,'0'))::uuid,v_base_date+offset_days,reason
from (values
  (1,3,10,'Demo: continuing medical education'),
  (2,7,12,'Demo: community outreach clinic'),
  (3,2,20,'Demo: scheduled leave')
) as blocked(n,doctor,offset_days,reason)
where not exists(select 1 from public.doctor_unavailable_dates existing where existing.id=('d3e00000-0003-4000-8000-'||lpad((n)::text,12,'0'))::uuid)
on conflict(id) do nothing;

-- 4. Eleven additional patient records; these are records, not extra login users.
-- Contact numbers are intentionally absent to prevent sending to invented numbers.
insert into public.patients(id,full_name,date_of_birth,contact_number,address)
select ('d3e00000-0004-4000-8000-'||lpad((n)::text,12,'0'))::uuid,name,dob,null,address from (values
  (2,'Juan Dela Cruz',date '1985-03-12','Poblacion, Bauang, La Union'),
  (3,'Pedro Reyes',date '1955-01-05','Central West, Bauang, La Union'),
  (4,'Ana Lopez',date '2022-05-10','Nagrebcan, Bauang, La Union'),
  (5,'Carmela Ramos',date '1998-11-30','Pilar, Bauang, La Union'),
  (6,'Jose Manalo',date '1948-09-18','Payocpoc, Bauang, La Union'),
  (7,'Grace Fernandez',date '1975-02-14','Baccuit, Bauang, La Union'),
  (8,'Ramon Torres',date '2001-06-25','Acao, Bauang, La Union'),
  (9,'Liza Gonzales',date '1988-12-01','Cabalayangan, Bauang, La Union'),
  (10,'Mark Villanueva',date '1965-04-09','Disso-or, Bauang, La Union'),
  (11,'Paula Mendoza',date '1995-08-16','Pagdalagan Sur, Bauang, La Union'),
  (12,'Nico Bautista',date '2018-10-09','Baccuit Norte, Bauang, La Union')
) as p(n,name,dob,address)
on conflict(id) do nothing;

-- Track inserted IDs in local arrays; re-runs leave subsequent interactions alone.

-- 5. Featured visits exercise every status and both booking sources.
-- Maria has past visits, today's check-in, upcoming bookings and a recurring chain.
with inserted as (
  insert into public.appointments(id,patient_id,doctor_id,scheduled_time,source,status,
    room,reason,checked_in_at,is_recurring,recurrence_parent_id,created_by,created_at)
  select ('d3e00000-0005-4000-8000-'||lpad((n)::text,12,'0'))::uuid,
    case when patient=1 then v_patient else ('d3e00000-0004-4000-8000-'||lpad((patient)::text,12,'0'))::uuid end,
    ('d3e00000-0001-4000-8000-'||lpad((doctor)::text,12,'0'))::uuid,
    ((v_base_date+offset_days)+slot) at time zone 'Asia/Manila',source,status,
    room,'Demo: '||reason,
    case when status in ('checked_in','waiting','in_progress','completed')
      then (((v_base_date+offset_days)+slot) at time zone 'Asia/Manila') - interval '10 minutes' end,
    parent is not null,case when parent is not null then ('d3e00000-0005-4000-8000-'||lpad((parent)::text,12,'0'))::uuid end,
    case when source='pre_booked' and patient=1 then v_user else v_admin end,
    ((v_base_date+least(offset_days-2,-2))+time '07:00') at time zone 'Asia/Manila'
  from (values
    (1,1,1,-7,time '09:00','pre_booked','completed','1','routine consultation',null::integer),
    (2,1,1,-2,time '10:00','pre_booked','cancelled',null,'cancelled consultation',null),
    (3,1,5,-1,time '09:00','pre_booked','no_show',null,'missed checkup',null),
    (4,1,1,0,time '08:30','walk_in','completed','1','completed morning visit',null),
    (5,3,5,0,time '09:00','pre_booked','in_progress','5','blood pressure review',null),
    (6,4,2,0,time '09:30','walk_in','waiting','2','child wellness consultation',null),
    (7,1,1,0,time '10:00','pre_booked','checked_in','1','follow-up review',null),
    (8,5,3,0,time '15:00','pre_booked','scheduled',null,'prenatal consultation',null),
    (9,8,8,0,time '15:30','pre_booked','pending',null,'ear and throat consultation',null),
    (10,9,6,0,time '16:00','pre_booked','cancelled',null,'skin consultation',null),
    (11,6,1,0,time '08:00','pre_booked','no_show',null,'missed routine consultation',null),
    (12,2,4,0,time '13:00','walk_in','scheduled',null,'dental checkup',null),
    (13,1,1,1,time '09:00','pre_booked','scheduled',null,'first weekly follow-up',1),
    (14,1,1,7,time '09:00','pre_booked','scheduled',null,'second weekly follow-up',13),
    (15,1,1,14,time '09:00','pre_booked','scheduled',null,'third weekly follow-up',14),
    (16,1,6,2,time '10:30','pre_booked','pending',null,'skin review awaiting confirmation',null),
    (17,1,4,3,time '14:00','pre_booked','scheduled',null,'dental consultation',null),
    (18,1,7,4,time '11:00','pre_booked','cancelled',null,'cancelled eye screening',null),
    (19,10,9,1,time '10:00','pre_booked','scheduled',null,'internal medicine checkup',null),
    (20,11,7,5,time '13:30','pre_booked','scheduled',null,'eye screening',null),
    (21,12,2,2,time '08:30','pre_booked','scheduled',null,'child wellness follow-up',null),
    (22,2,10,-15,time '11:00','walk_in','completed','10','historical orthopedic consultation',null)
  ) as visits(n,patient,doctor,offset_days,slot,source,status,room,reason,parent)

  on conflict(id) do nothing
  returning id
) select coalesce(array_agg(id),array[]::uuid[]) into v_new_featured from inserted;

-- 6. Ninety historical visits over the last thirty days populate reports/charts.
-- Jose has repeated no-shows to demonstrate the report's repeat no-show list.
with inserted as (
  insert into public.appointments(id,patient_id,doctor_id,scheduled_time,source,status,
    room,reason,checked_in_at,created_by,created_at)
  select ('d3e00000-0005-4000-8000-'||lpad((100+(day-1)*3+visit)::text,12,'0'))::uuid,
    case when visit=1 then v_patient when visit=3 then ('d3e00000-0004-4000-8000-'||lpad((6)::text,12,'0'))::uuid
      else ('d3e00000-0004-4000-8000-'||lpad((2+(day%11))::text,12,'0'))::uuid end,
    ('d3e00000-0001-4000-8000-'||lpad((1+((day+visit)%9))::text,12,'0'))::uuid,
    ((v_base_date-day)+time '11:30'+make_interval(mins=>(visit-1)*30)) at time zone 'Asia/Manila',
    case when visit=2 then 'walk_in' else 'pre_booked' end,
    case when visit=3 and day%4=0 then 'no_show'
      when visit=3 and day%5=0 then 'cancelled' else 'completed' end,
    case when visit=3 and (day%4=0 or day%5=0) then null else (1+((day+visit)%9))::text end,
    'Demo: historical clinic consultation',
    case when not (visit=3 and (day%4=0 or day%5=0))
      then ((v_base_date-day)+time '11:20'+make_interval(mins=>(visit-1)*30)) at time zone 'Asia/Manila' end,
    case when visit=1 then v_user else v_admin end,
    ((v_base_date-day-2)+time '07:00') at time zone 'Asia/Manila'
  from generate_series(1,30) day cross join generate_series(1,3) visit
  on conflict(id) do nothing
  returning id
) select coalesce(array_agg(id),array[]::uuid[]) into v_new_history from inserted;
v_new_appointments := v_new_featured || v_new_history;

-- 7. A note for every completed demo visit, linked to its exact patient/visit.
insert into public.patient_visit_notes(id,patient_id,appointment_id,note,created_by,created_at)
select ('d3e00000-0006-4000-8000-'||right(a.id::text,12))::uuid,a.patient_id,a.id,
  'DEMO ONLY: Sample consultation record. Review completed; follow-up discussed. This is fictional clinical history.',
  v_admin,a.scheduled_time+interval '25 minutes'
from public.appointments a
where a.id::text like 'd3e00000-0005-4000-8000-%' and a.status='completed'
on conflict(id) do nothing;

-- 8. Real audit triggers automatically recorded each inserted appointment.
-- Add clearly marked sample lifecycle entries to exercise report action filters.
insert into public.audit_log(id,actor_id,action,entity,entity_id,old_value,new_value,created_at)
select ('d3e00000-0007-4000-8000-'||lpad((n)::text,12,'0'))::uuid,case when patient_actor then v_user else v_admin end,
  action,'appointment',('d3e00000-0005-4000-8000-'||lpad((appointment)::text,12,'0'))::uuid,
  jsonb_build_object('demo',true,'status',old_status),
  jsonb_build_object('demo',true,'status',new_status,'description',description),
  now()-make_interval(mins=>n*5)
from (values
  (1,7,'status_change','scheduled','checked_in','Sample check-in',false),
  (2,4,'status_change','in_progress','completed','Sample completed visit',false),
  (3,2,'cancel','scheduled','cancelled','Sample patient cancellation',true),
  (4,17,'reschedule','scheduled','scheduled','Sample rescheduling audit entry',true),
  (5,13,'update','scheduled','scheduled','Sample appointment detail edit',false)
) as logs(n,appointment,action,old_status,new_status,description,patient_actor)
on conflict(id) do nothing;

-- 9. Quarantine automatically queued demo notices BEFORE committing.
-- Only notices for newly inserted visits are affected. No provider is invoked.
update public.notification_attempts n
set status='stubbed',provider='none',error_summary='not_configured',retry_at=null
where n.appointment_id=any(v_new_appointments) and n.status='pending';

-- Examples of each notification type remain truthfully marked unsent.
insert into public.notification_attempts(appointment_id,patient_id,notification_type,
  revision,scheduled_time,status,provider,error_summary,created_at)
select a.id,a.patient_id,notice_type,v.revision,a.scheduled_time,
  'stubbed','none','not_configured',now()
from (values (13,'reminder'),(17,'reschedule'),(18,'cancellation')) as examples(n,notice_type)
join public.appointments a on a.id=('d3e00000-0005-4000-8000-'||lpad((examples.n)::text,12,'0'))::uuid
join public.appointment_notification_versions v on v.appointment_id=a.id
where a.id=any(v_new_appointments)
on conflict(appointment_id,notification_type,revision,channel) do nothing;

-- 10. Report the inventory without depending on any session-local relation.
select jsonb_build_object(
  'result','Demo data ready; existing login passwords preserved',
  'admin_email',v_admin_email,'patient_email',v_patient_email,
  'doctors',(select count(*) from public.doctors where id::text like 'd3e00000-0001-%'),
  'schedules',(select count(*) from public.doctor_schedules where id::text like 'd3e00000-0002-%'),
  'blocked_dates',(select count(*) from public.doctor_unavailable_dates where id::text like 'd3e00000-0003-%'),
  'patient_records',(select count(*) from public.patients where id::text like 'd3e00000-0004-%' or id=v_patient),
  'appointments',(select count(*) from public.appointments where id::text like 'd3e00000-0005-%'),
  'visit_notes',(select count(*) from public.patient_visit_notes where id::text like 'd3e00000-0006-%'),
  'audit_entries',(select count(*) from public.audit_log where entity_id::text like 'd3e00000-0005-%'),
  'notification_samples',(select count(*) from public.notification_attempts where appointment_id::text like 'd3e00000-0005-%')
) into v_inventory;
raise notice 'Demo import complete: %',v_inventory;
end $medicappointment_demo$;
