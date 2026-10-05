// Validate the import only in disposable loopback PostgreSQL; no project secrets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localTestDatabase } from './local-test-db.mjs';

const demo = readFileSync('supabase/demo_data.sql', 'utf8');
const full = readFileSync('supabase/full_demo.sql', 'utf8');
const schema = readFileSync('supabase/schema.sql', 'utf8');
assert.ok(full.endsWith(schema + '\n\n' + demo), 'Standalone import must contain the exact current schema and demo data.');
const seedBlock = demo.slice(demo.indexOf('do $medicappointment_demo$'));
assert.ok(seedBlock.startsWith('do $medicappointment_demo$') && seedBlock.trimEnd().endsWith('end $medicappointment_demo$;'));
assert.doesNotMatch(demo,/create\s+(?:temporary|temp)\s|pg_temp\.|demo_accounts|demo_new_appointments/i,
  'Demo import must not require session-local tables or functions.');
const db = await localTestDatabase();
const sql = db.sql;
const admin = '00000000-0000-4000-8000-000000000001';
const patient = '00000000-0000-4000-8000-000000000002';
const existingPatient = '10000000-0000-4000-8000-000000000002';
// Model the columns used by current Supabase Auth, including token string fields
// and the email identity uniqueness/generated-email constraints.
const authTables = `create table if not exists auth.users(id uuid primary key);
  alter table auth.users
    add column email text unique,
    add column instance_id uuid,
    add column aud text,
    add column role text,
    add column encrypted_password text,
    add column email_confirmed_at timestamptz,
    add column raw_app_meta_data jsonb,
    add column raw_user_meta_data jsonb,
    add column created_at timestamptz,
    add column updated_at timestamptz,
    add column confirmation_token text,
    add column recovery_token text,
    add column email_change_token_new text,
    add column email_change_token_current text,
    add column email_change text,
    add column phone_change text,
    add column phone_change_token text,
    add column reauthentication_token text,
    add column is_sso_user boolean not null default false,
    add column is_anonymous boolean not null default false;
  create table auth.identities(id uuid primary key, user_id uuid not null references auth.users(id),
    provider_id text not null, identity_data jsonb not null, provider text not null,
    created_at timestamptz not null, updated_at timestamptz not null,
    email text generated always as (lower(identity_data->>'email')) stored,
    unique(provider_id,provider));`;
const freshAuth = `create schema auth; ${authTables}
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth,public to authenticated,anon,service_role;`;
const json = query => JSON.parse(sql(query).stdout.trim());
const id = (kind, number) => `d3e00000-${String(kind).padStart(4,'0')}-4000-8000-${String(number).padStart(12,'0')}`;
const snapshot = () => json(`select jsonb_build_object(
  'authUsers',(select jsonb_agg(to_jsonb(t) order by id) from auth.users t),
  'identities',(select jsonb_agg(to_jsonb(t) order by id) from auth.identities t),
  'appointments',(select jsonb_agg(to_jsonb(t) order by id) from public.appointments t),
  'notes',(select jsonb_agg(to_jsonb(t) order by id) from public.patient_visit_notes t),
  'audit',(select jsonb_agg(to_jsonb(t) order by id) from public.audit_log t),
  'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notification_attempts t),
  'versions',(select jsonb_agg(to_jsonb(t) order by appointment_id) from public.appointment_notification_versions t),
  'profiles',(select jsonb_agg(to_jsonb(t) order by id) from public.profiles t),
  'patients',(select jsonb_agg(to_jsonb(t) order by id) from public.patients t),
  'doctors',(select jsonb_agg(to_jsonb(t) order by id) from public.doctors t),
  'schedules',(select jsonb_agg(to_jsonb(t) order by id) from public.doctor_schedules t),
  'blocks',(select jsonb_agg(to_jsonb(t) order by id) from public.doctor_unavailable_dates t));`);
try {
  sql(authTables);
  db.install('supabase/schema.sql');
  // Role conflicts must roll back newly provisioned accounts and all demo data.
  sql(`insert into auth.users(id,email,encrypted_password,raw_app_meta_data) values
    ('${admin}','vacunawa@gmail.com',crypt('ExistingAdminPassword!',gen_salt('bf')), '{"provider":"email","custom":"preserve"}');
    insert into public.profiles(id,full_name,role) values ('${admin}','Existing Administrator','patient');`);
  const conflictBefore = snapshot();
  const wrongRole = sql(demo,'phase3_test',true);
  assert.notEqual(wrongRole.status,0);
  assert.match(wrongRole.stderr,/existing selected accounts must have admin and patient roles/);
  assert.deepEqual(snapshot(),conflictBefore);
  console.log('PASS role conflicts roll back account creation without altering existing users');

  sql(`update public.profiles set role='admin' where id='${admin}';
    insert into auth.users(id,email,encrypted_password) values
      ('${patient}','patient@gmail.com',crypt('ExistingPatientPassword!',gen_salt('bf')));
    insert into public.profiles(id,full_name,role) values ('${patient}','Existing Patient','patient');
    insert into public.patients(id,user_id,full_name,date_of_birth,address) values
      ('${existingPatient}','${patient}','Existing Patient','1992-01-15','Existing address');`);
  const existing = json(`select to_jsonb(p) from public.patients p where id='${existingPatient}';`);
  const existingAuth = json('select jsonb_agg(to_jsonb(u) order by id) from auth.users u;');
  // Use an unrelated session timezone to catch implicit current_date/timestamp casts.
  sql("set timezone='America/Los_Angeles';\n" + full);
  assert.deepEqual(json(`select to_jsonb(p) from public.patients p where id='${existingPatient}';`), existing);
  assert.deepEqual(json('select jsonb_agg(to_jsonb(u) order by id) from auth.users u;'),existingAuth);
  assert.equal(sql('select count(*) from auth.users;').stdout.trim(), '2');
  const counts = json(`select jsonb_build_object('doctors',(select count(*) from doctors),
    'schedules',(select count(*) from doctor_schedules),'blocked',(select count(*) from doctor_unavailable_dates),
    'patients',(select count(*) from patients),'appointments',(select count(*) from appointments),
    'notes',(select count(*) from patient_visit_notes),'notifications',(select count(*) from notification_attempts),
    'versions',(select count(*) from appointment_notification_versions),'statuses',(select count(distinct status) from appointments));`);
  assert.deepEqual(counts, { doctors:10,schedules:70,blocked:3,patients:12,appointments:112,notes:81,notifications:12,versions:112,statuses:8 });
  assert.equal(sql(`select count(*) from appointments where patient_id='${existingPatient}';`).stdout.trim(), '41');
  assert.equal(sql(`select count(*) from appointments where id='${id(5,13)}'
    and (scheduled_time at time zone 'Asia/Manila')::date=(now() at time zone 'Asia/Manila')::date+1
    and (scheduled_time at time zone 'Asia/Manila')::time=time '09:00';`).stdout.trim(), '1');
  assert.equal(sql("select count(*) from notification_attempts where status<>'stubbed' or provider<>'none' or retry_at is not null;").stdout.trim(),'0');
  assert.equal(sql(`select count(*) from patient_visit_notes n join appointments a on a.id=n.appointment_id where n.patient_id<>a.patient_id;`).stdout.trim(),'0');
  assert.equal(sql(`select count(*) from appointments a join doctor_unavailable_dates b on b.doctor_id=a.doctor_id
    and b.date=(a.scheduled_time at time zone 'Asia/Manila')::date where a.status not in ('cancelled','no_show');`).stdout.trim(),'0');
  console.log('PASS standalone import, all modules, both existing accounts and Manila times');

  const before = snapshot();
  sql(demo);
  assert.deepEqual(snapshot(), before);
  console.log('PASS re-running demo import preserves every row and creates no duplicate audits');

  // Test the actual patient/staff portal operations and row privacy on seeded data.
  sql(`grant select on all tables in schema public to authenticated;`);
  const own = json(`set role authenticated; set request.jwt.claim.sub='${patient}'; select jsonb_agg(distinct patient_id) from appointments;`);
  assert.deepEqual(own, [existingPatient]);
  const report = json(`set role authenticated; set request.jwt.claim.sub='${admin}';
    select public.staff_appointment_report((now() at time zone 'Asia/Manila')::date-30,(now() at time zone 'Asia/Manila')::date+30);`);
  assert.equal(report.total,112);
  assert.ok(report.noShowPatients.some(p => p.noShow>=2));
  const slots = json(`set role authenticated; set request.jwt.claim.sub='${patient}';
    select jsonb_agg(s) from public.get_available_appointment_slots('${id(1,1)}',(now() at time zone 'Asia/Manila')::date+1) s;`);
  assert.ok(Array.isArray(slots) && slots.length>0);
  sql(`set role authenticated; set request.jwt.claim.sub='${patient}'; select public.cancel_appointment('${id(5,13)}');`);
  const interacted = snapshot();
  sql(demo);
  assert.deepEqual(snapshot(), interacted);
  console.log('PASS patient privacy, staff reports, availability and preservation of subsequent cancellation');

  // An empty application/Auth database exercises the reported missing-user failure.
  sql('create database demo_fresh;', 'postgres');
  sql(freshAuth, 'demo_fresh');
  sql(full,'demo_fresh');
  const freshJson = query => JSON.parse(sql(query,'demo_fresh').stdout.trim());
  assert.equal(sql('select count(*) from profiles;', 'demo_fresh').stdout.trim(),'2');
  assert.equal(sql(`select count(*) from patients p join auth.users u on u.id=p.user_id where u.email='patient@gmail.com';`, 'demo_fresh').stdout.trim(),'1');
  assert.equal(sql('select count(*) from appointments;', 'demo_fresh').stdout.trim(),'112');
  const accounts = freshJson(`select jsonb_agg(jsonb_build_object('email',u.email,'role',p.role,
    'confirmed',u.email_confirmed_at is not null,'password_valid',
    u.encrypted_password=crypt(case p.role when 'admin' then 'admin123' else 'patient123' end,u.encrypted_password),
    'tokens_valid',u.confirmation_token='' and u.recovery_token='' and u.email_change_token_new=''
      and u.email_change_token_current='' and u.email_change='' and u.phone_change=''
      and u.phone_change_token='' and u.reauthentication_token='',
    'identity_valid',i.provider='email' and i.provider_id=u.id::text and i.email=u.email
      and i.identity_data->>'sub'=u.id::text and i.identity_data->>'email_verified'='true') order by u.email)
    from auth.users u join profiles p on p.id=u.id join auth.identities i on i.user_id=u.id;`);
  assert.deepEqual(accounts,[
    {email:'patient@gmail.com',role:'patient',confirmed:true,password_valid:true,tokens_valid:true,identity_valid:true},
    {email:'vacunawa@gmail.com',role:'admin',confirmed:true,password_valid:true,tokens_valid:true,identity_valid:true}
  ]);
  const authBefore = freshJson('select jsonb_agg(to_jsonb(u) order by id) from auth.users u;');
  const identityBefore = freshJson('select jsonb_agg(to_jsonb(i) order by id) from auth.identities i;');
  sql(demo,'demo_fresh');
  assert.deepEqual(freshJson('select jsonb_agg(to_jsonb(u) order by id) from auth.users u;'),authBefore);
  assert.deepEqual(freshJson('select jsonb_agg(to_jsonb(i) order by id) from auth.identities i;'),identityBefore);
  console.log('PASS empty database creates both accounts, confirmed email identities and correct bcrypt passwords; reruns preserve hashes');

  // Run only the single DO statement on a new connection, with no BEGIN or setup
  // statements from the demo file. An error at the very end must roll everything back.
  sql('create database demo_atomic;', 'postgres');
  sql(freshAuth,'demo_atomic');
  sql(schema,'demo_atomic');
  sql('create schema extensions; alter extension pgcrypto set schema extensions;','demo_atomic');
  const lateFailure = seedBlock.replace('end $medicappointment_demo$;',
    "raise exception 'test late failure'; end $medicappointment_demo$;");
  const failedAtomic = sql(lateFailure,'demo_atomic',true);
  assert.notEqual(failedAtomic.status,0);
  assert.match(failedAtomic.stderr,/test late failure/);
  assert.equal(sql(`select (select count(*) from auth.users)+(select count(*) from public.profiles)
    +(select count(*) from public.doctors)+(select count(*) from public.appointments)
    +(select count(*) from public.patient_visit_notes)+(select count(*) from public.audit_log)
    +(select count(*) from public.notification_attempts);`,'demo_atomic').stdout.trim(),'0');
  sql("set search_path=pg_catalog;\n"+seedBlock,'demo_atomic');
  assert.equal(sql('select count(*) from public.appointments;','demo_atomic').stdout.trim(),'112');
  sql(seedBlock,'demo_atomic');
  assert.equal(sql('select count(*) from public.appointments;','demo_atomic').stdout.trim(),'112');
  assert.equal(sql('select count(*) from auth.users;','demo_atomic').stdout.trim(),'2');
  console.log('PASS standalone DO on fresh connections, extensions schema and complete rollback after late failure');

  sql('create database demo_partial;', 'postgres');
  sql(freshAuth,'demo_partial');
  sql(schema,'demo_partial');
  // Simulate a project's existing Auth signup trigger which defaults profiles to patient.
  sql(`create function public.demo_test_signup() returns trigger language plpgsql as $$ begin
    insert into public.profiles(id,full_name,role) values(new.id,coalesce(new.raw_user_meta_data->>'full_name','Existing Patient'),'patient');
    return new; end $$;
    create trigger demo_test_signup after insert on auth.users for each row execute function public.demo_test_signup();
    insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values
      ('${patient}','patient@gmail.com',crypt('KeepThisPassword!',gen_salt('bf')),'{"full_name":"Existing Patient"}');
    insert into public.patients(id,user_id,full_name) values('${existingPatient}','${patient}','Existing Patient');`,'demo_partial');
  const partialJson = query => JSON.parse(sql(query,'demo_partial').stdout.trim());
  const partialBefore = partialJson(`select to_jsonb(u) from auth.users u where id='${patient}';`);
  sql(demo,'demo_partial');
  assert.deepEqual(partialJson(`select to_jsonb(u) from auth.users u where id='${patient}';`),partialBefore);
  assert.equal(sql(`select p.role from profiles p join auth.users u on u.id=p.id where u.email='vacunawa@gmail.com';`,'demo_partial').stdout.trim(),'admin');
  assert.equal(sql(`select count(*) from appointments where patient_id='${existingPatient}';`,'demo_partial').stdout.trim(),'41');
  assert.equal(sql('select count(*) from auth.users;','demo_partial').stdout.trim(),'2');
  console.log('PASS one existing account is preserved; missing admin gets intended role despite signup trigger');
} finally {
  db.close();
}
