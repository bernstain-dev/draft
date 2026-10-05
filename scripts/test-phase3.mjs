import './test-phase3-ui.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localTestDatabase } from './local-test-db.mjs';
const read = file => readFileSync(file,'utf8');
const marker = '-- BEGIN CANONICAL PHASE 3 OPERATIONS', end = '-- END CANONICAL PHASE 3 OPERATIONS';
const block = s => s.slice(s.indexOf(marker),s.indexOf(end)+end.length);
for (const file of ['supabase/schema.sql','supabase/full.sql','supabase/migrate_patient_booking.sql']) assert.equal(block(read(file)),block(read('supabase/fix_phase3_notifications_reports.sql')));
console.log('PASS Phase 3 canonical installation/upgrade copies match');
const db = await localTestDatabase();
const uid={admin:'00000000-0000-0000-0000-000000000001',a:'00000000-0000-0000-0000-000000000002',b:'00000000-0000-0000-0000-000000000003'};
const pa='10000000-0000-0000-0000-000000000001',pb='10000000-0000-0000-0000-000000000002',doctor='20000000-0000-0000-0000-000000000001',doctor2='20000000-0000-0000-0000-000000000002';
const sql = db.sql, json = r => JSON.parse(r.stdout.trim());
const actor = (name,text) => sql(`set role authenticated; set request.jwt.claim.sub='${uid[name]}'; ${text}`);
const service = text => sql(`set role service_role; ${text}`);
const fail = (text,pattern) => { const r=sql(text,'phase3_test',true); assert.notEqual(r.status,0); if(pattern) assert.match(r.stderr,pattern); };
const snapshot = () => sql(`select jsonb_build_object('patients',(select jsonb_agg(to_jsonb(t) order by id) from public.patients t),
  'appointments',(select jsonb_agg(to_jsonb(t) order by id) from public.appointments t),'doctors',(select jsonb_agg(to_jsonb(t) order by id) from public.doctors t),
  'profiles',(select jsonb_agg(to_jsonb(t) order by id) from public.profiles t),'audit',(select jsonb_agg(to_jsonb(t) order by id) from public.audit_log t),
  'notes',(select jsonb_agg(to_jsonb(t) order by id) from public.patient_visit_notes t),
  'schedules',(select jsonb_agg(to_jsonb(t) order by id) from public.doctor_schedules t),
  'unavailable',(select jsonb_agg(to_jsonb(t) order by id) from public.doctor_unavailable_dates t));`).stdout;
const slot = (day,time='09:00') => `(timestamp '2030-10-${String(day).padStart(2,'0')} ${time}' at time zone 'Asia/Manila')`;
let passed=0;
async function test(name,fn) { await fn();passed++;console.log('PASS '+name); }
try {
  const fresh = read('supabase/schema.sql');
  sql(fresh.slice(0, fresh.lastIndexOf('begin;',fresh.indexOf(marker))));
  sql(`insert into auth.users values ${Object.values(uid).map(id=>`('${id}')`).join(',')};
    insert into public.profiles(id,full_name,role) values ('${uid.admin}','Synthetic Admin','admin'),('${uid.a}','Same Patient','patient'),('${uid.b}','Same Patient','patient');
    insert into public.patients(id,user_id,full_name,contact_number) values ('${pa}','${uid.a}','Same Patient','09123456789'),('${pb}','${uid.b}','Same Patient','09123456789');
    insert into public.doctors(id,full_name,specialty) values ('${doctor}','Same Doctor','General'),('${doctor2}','Same Doctor','General');
    insert into public.doctor_schedules(doctor_id,day_of_week,start_time,end_time,slot_duration_minutes)
      select d,day,'08:00','17:00',30 from unnest(array['${doctor}'::uuid,'${doctor2}'::uuid])d cross join generate_series(0,6)day;
    insert into public.appointments(patient_id,doctor_id,scheduled_time,status) values('${pa}','${doctor}',${slot(1)},'completed');
    insert into public.patient_visit_notes(patient_id,appointment_id,note,created_by)
      select patient_id,id,'Synthetic historical note','${uid.admin}' from public.appointments where status='completed';`);
  await test('Migration preserves existing rows/index and is repeatable',()=>{
    const before=snapshot(), oid=sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout;
    db.install('supabase/fix_phase3_notifications_reports.sql');db.install('supabase/fix_phase3_notifications_reports.sql');
    assert.equal(snapshot(),before);assert.equal(sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout,oid);
    assert.equal(sql('select count(*) from public.notification_attempts;').stdout.trim(),'0');
  });
  let appointment,event;
  await test('E: committed bookings enqueue once; failed transactions enqueue nothing; own/admin authorization only',()=>{
    appointment=json(actor('a',`select public.book_appointment('${doctor}',${slot(10)});`)).id;
    event=actor('a',`select public.request_appointment_notification('${appointment}');`).stdout.trim();
    assert.equal(actor('admin',`select public.request_appointment_notification('${appointment}');`).stdout.trim(),event);
    fail(`set role authenticated;set request.jwt.claim.sub='${uid.b}';select public.request_appointment_notification('${appointment}');`,/not authorized/);
    fail(`set role authenticated;set request.jwt.claim.sub='${uid.b}';select public.book_appointment('${doctor}',${slot(10)});`,/already been booked/);
    assert.equal(sql(`select count(*) from public.notification_attempts where appointment_id='${appointment}';`).stdout.trim(),'1');
  });
  await test('Concurrent claims send once; accepted rows cannot be claimed again',async()=>{
    const requests=await Promise.all([1,2].map(()=>db.concurrent(`begin; set role service_role; select public.claim_appointment_notifications('${event}',1); select pg_sleep(0.3);commit;`)));
    requests.forEach(r=>assert.equal(r.status,0,r.stderr));const claims=requests.flatMap(json);assert.equal(claims.length,1);
    service(`select public.finish_appointment_notification('${event}','${claims[0].lease_token}','accepted','twilio','synthetic-reference');`);
    assert.deepEqual(json(service(`select public.claim_appointment_notifications('${event}',1);`)),[]);
    const result=json(service(`select public.notification_result('${event}');`));assert.equal(result.accepted,true);assert.equal(result.delivery,'not_verified');
  });
  await test('F/G: Manila tomorrow window, morning gate and durable reminder deduplication',()=>{
    assert.equal(service("select public.queue_due_appointment_reminders('2030-10-08T22:00:00Z');").stdout.trim(),'0');
    service("select public.queue_due_appointment_reminders('2030-10-08T23:00:00Z');");
    assert.equal(service("select public.queue_due_appointment_reminders('2030-10-08T23:00:00Z');").stdout.trim(),'0');
    assert.equal(sql(`select count(*) from public.notification_attempts where appointment_id='${appointment}' and notification_type='reminder';`).stdout.trim(),'1');
    const outputs=['Asia/Manila','UTC','America/New_York'].map(z=>service(`set timezone='${z}';select public.queue_due_appointment_reminders('2030-10-08T23:00:00Z');`).stdout.trim());assert.deepEqual(outputs,['0','0','0']);
  });
  await test('Delivery callbacks record delivery once and cannot downgrade terminal state',()=>{
    service("select public.record_notification_delivery('synthetic-reference','delivered');");
    const first=sql(`select delivered_at from public.notification_attempts where id='${event}';`).stdout;
    service("select public.record_notification_delivery('synthetic-reference','delivered');select public.record_notification_delivery('synthetic-reference','queued');");
    assert.equal(sql(`select delivered_at from public.notification_attempts where id='${event}';`).stdout,first);
    assert.equal(json(service(`select public.notification_result('${event}');`)).delivery,'delivered');
    fail("set role authenticated;select public.record_notification_delivery('synthetic-reference','delivered');",/permission denied/);
  });
  await test('H/I: reschedule supersedes old notice and uses new instant; cancellation prevents reminder',()=>{
    actor('a',`select public.reschedule_appointment('${appointment}','${doctor}',${slot(11,'09:30')});`);
    assert.equal(sql(`select status from public.notification_attempts where appointment_id='${appointment}' and notification_type='reminder';`).stdout.trim(),'superseded');
    const id=actor('a',`select public.request_appointment_notification('${appointment}','reschedule');`).stdout.trim();
    const claims=json(service(`select public.claim_appointment_notifications('${id}',1);`));assert.equal(claims.length,1);
    assert.equal(Date.parse(claims[0].scheduled_time),Date.parse('2030-10-11T01:30:00Z'));
    service(`select public.finish_appointment_notification('${id}','${claims[0].lease_token}','stubbed','none',null,'not_configured');`);
    service("select public.queue_due_appointment_reminders('2030-10-09T23:00:00Z');");
    actor('a',`select public.cancel_appointment('${appointment}');`);
    const reminders=sql(`select count(*) from public.notification_attempts where appointment_id='${appointment}' and notification_type='reminder' and status='pending';`).stdout.trim();assert.equal(reminders,'0');
    assert.equal(service("select public.queue_due_appointment_reminders('2030-10-09T23:00:00Z');").stdout.trim(),'0');
  });
  await test('Known retry is bounded; ambiguous/expired attempts are held without duplicate sends',()=>{
    const id=actor('a',`select public.request_appointment_notification('${appointment}','cancellation');`).stdout.trim();
    const claim=json(service(`select public.claim_appointment_notifications('${id}',1);`))[0];
    service(`select public.finish_appointment_notification('${id}','${claim.lease_token}','failed','twilio',null,'rate_limited',true);`);
    assert.deepEqual(json(service(`select public.claim_appointment_notifications('${id}',1);`)),[]);
    sql(`update public.notification_attempts set retry_at=now()-interval '1 minute' where id='${id}';`);
    const retry=json(service(`select public.claim_appointment_notifications('${id}',1);`))[0];assert.ok(retry);
    service(`select public.finish_appointment_notification('${id}','${retry.lease_token}','unknown','twilio',null,'transport_unknown',false);`);
    assert.deepEqual(json(service(`select public.claim_appointment_notifications('${id}',1);`)),[]);
    sql(`update public.notification_attempts set status='processing',last_attempt_at=now()-interval '10 minutes' where id='${id}';`);
    assert.deepEqual(json(service(`select public.claim_appointment_notifications('${id}',1);`)),[]);
    assert.equal(sql(`select status from public.notification_attempts where id='${id}';`).stdout.trim(),'unknown');
  });
  await test('J/K: reports group by immutable IDs and Manila date; totals exceed browser row caps',()=>{
    sql(`insert into public.appointments(patient_id,doctor_id,scheduled_time,status) values
      ('${pa}','${doctor}',${slot(12,'08:00')},'no_show'),('${pb}','${doctor2}',${slot(12,'08:00')},'no_show'),
      ('${pa}','${doctor}',${slot(12,'08:30')},'no_show'),('${pb}','${doctor2}',${slot(12,'08:30')},'no_show');
      insert into public.appointments(patient_id,doctor_id,scheduled_time,status)
        select '${pa}','${doctor}',${slot(12,'09:00')},'cancelled' from generate_series(1,1501);`);
    const report=json(actor('admin',"select public.staff_appointment_report('2030-10-12','2030-10-12');"));
    assert.equal(report.total,1505);assert.equal(report.perDay['2030-10-12'],1505);assert.equal(report.perDoctor.length,2);assert.equal(report.noShowPatients.length,2);
    assert.notEqual(report.perDoctor[0].id,report.perDoctor[1].id);assert.notEqual(report.noShowPatients[0].id,report.noShowPatients[1].id);
    const filtered=json(actor('admin',`select public.staff_appointment_report('2030-10-12','2030-10-12','${doctor2}');`));assert.equal(filtered.total,2);
    fail(`set role authenticated;set request.jwt.claim.sub='${uid.a}';select public.staff_appointment_report('2030-10-12','2030-10-12');`,/authorization/);
    const audit=json(actor('admin',"select public.staff_report_audit('2020-01-01','2020-01-01');"));assert.deepEqual(audit.rows,[]);
  });
  await test('M: doctor backend edit validation and non-destructive deactivation',()=>{
    for(const [name,specialty]of [['   ','General'],['X'.repeat(201),'General'],['Doctor',' '.repeat(3)],['Doctor','X'.repeat(121)]]) fail(`set role authenticated;set request.jwt.claim.sub='${uid.admin}';update public.doctors set full_name='${name}',specialty='${specialty}' where id='${doctor}';`,/Doctor name/);
    actor('admin',`update public.doctors set full_name='Edited Doctor',specialty='Family Medicine',is_active=false where id='${doctor}';`);
    assert.ok(Number(sql(`select count(*) from public.appointments where doctor_id='${doctor}';`).stdout)>0);
    fail(`set role authenticated;set request.jwt.claim.sub='${uid.admin}';delete from public.doctors where id='${doctor}';`,/permission denied/);
  });
  await test('Clinic date boundary and audit pagination are complete rather than runtime-local/capped',()=>{
    fail(`set role authenticated;set request.jwt.claim.sub='${uid.admin}';select public.staff_report_audit('2030-10-13','2030-10-13',null,0,null);`,/Invalid audit report/);
    fail('set role service_role;select public.claim_appointment_notifications(null,null);',/batch must/);
    sql(`insert into public.appointments(patient_id,doctor_id,scheduled_time,status)
      values('${pa}','${doctor2}',${slot(13,'00:30')},'cancelled');
      insert into public.audit_log(action,entity,entity_id,created_at)
        select 'synthetic_paging','appointment','${appointment}',${slot(13,'00:30')} from generate_series(1,105);`);
    for (const zone of ['Asia/Manila','UTC','America/New_York']) {
      const report=json(actor('admin',`set timezone='${zone}';select public.staff_appointment_report('2030-10-13','2030-10-13');`));
      assert.equal(report.total,1);assert.deepEqual(report.perDay,{'2030-10-13':1});
      const first=json(actor('admin',`set timezone='${zone}';select public.staff_report_audit('2030-10-13','2030-10-13','synthetic_paging',0,100);`));
      const second=json(actor('admin',"select public.staff_report_audit('2030-10-13','2030-10-13','synthetic_paging',100,100);"));
      assert.equal(first.total,105);assert.equal(first.rows.length,100);assert.equal(second.rows.length,5);
      assert.equal(new Set([...first.rows,...second.rows].map(row=>row.id)).size,105);
    }
  });
  await test('Admin duplicate review is complete and private; visit notes cannot attach to another patient',()=>{
    assert.equal(actor('admin',"select public.admin_patient_duplicate_count(' Same Patient ',null,'09123456789');").stdout.trim(),'2');
    fail(`set role authenticated;set request.jwt.claim.sub='${uid.a}';select public.admin_patient_duplicate_count('Same Patient',null,'09123456789');`,/authorization/);
    for(const [patient,note]of [[pb,'Wrong patient'],[pa,'   '],[pa,'X'.repeat(3001)]])
      fail(`set role authenticated;set request.jwt.claim.sub='${uid.admin}';insert into public.patient_visit_notes(patient_id,appointment_id,note)values('${patient}','${appointment}','${note}');`,/Visit note/);
    actor('admin',`insert into public.patient_visit_notes(patient_id,appointment_id,note,created_by)values('${pa}','${appointment}','Synthetic valid note','${uid.a}');`);
    assert.equal(sql(`select created_by from public.patient_visit_notes where appointment_id='${appointment}';`).stdout.trim(),uid.admin);
  });
  await test('Patient/profile validation is backend authoritative and own profile mirroring is atomic',()=>{
    actor('a',"select public.patient_save_profile('Updated Patient','2000-01-01','09123456789','Synthetic address');");
    assert.equal(sql(`select full_name from public.profiles where id='${uid.a}';`).stdout.trim(),'Updated Patient');
    for(const params of ["' ',null,null,null","'Valid','2099-01-01',null,null","'Valid',null,'garbage',null"])
      fail(`set role authenticated;set request.jwt.claim.sub='${uid.a}';select public.patient_save_profile(${params});`,/patient name|Date of birth/);
    assert.equal(sql(`select full_name from public.profiles where id='${uid.a}';`).stdout.trim(),'Updated Patient');
    fail(`set role authenticated;set request.jwt.claim.sub='${uid.a}';update public.profiles set role='admin' where id='${uid.a}';`,/permission denied/);
  });
  await test('Incompatible pre-existing demographics abort incremental installation without rewriting records',()=>{
    sql(`alter table public.doctors disable trigger phase3_validate_form; insert into public.doctors(id,full_name) values('20000000-0000-0000-0000-000000000099','   '); alter table public.doctors enable trigger phase3_validate_form;`);
    const before=snapshot();const result=sql(read('supabase/fix_phase3_notifications_reports.sql'),'phase3_test',true);
    assert.notEqual(result.status,0);assert.match(result.stderr,/Phase 3 aborted: 1 invalid doctor/);assert.equal(snapshot(),before);
    // Only the synthetic invalid fixture is removed by its trusted test owner.
    sql("delete from public.doctors where id='20000000-0000-0000-0000-000000000099';");
  });
  await test('Notification ledger privacy and service-only worker ACLs',()=>{
    assert.equal(actor('a','select count(*) from public.notification_attempts;').stdout.trim(),'0');
    assert.ok(Number(actor('admin','select count(*) from public.notification_attempts;').stdout)>0);
    for(const call of ['public.claim_appointment_notifications()','public.queue_due_appointment_reminders()','public.notification_result(null)'])
      fail(`set role authenticated;set request.jwt.claim.sub='${uid.a}';select ${call};`,/permission denied/);
    assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not (p.proconfig @> array['search_path=\"\"']);").stdout.trim(),'0');
  });
  await test('Deployable scheduler uses Vault and a single named cron job; no credentials embedded',()=>{
    sql(`create schema vault;create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
      insert into vault.decrypted_secrets values ('medicappointment_url','https://synthetic.invalid'),('medicappointment_anon_key','synthetic-public-key'),('medicappointment_cron_secret','synthetic-cron-secret');
      create schema net;create table net.calls(headers jsonb,url text);
      create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$begin insert into net.calls values(headers,url);return 1;end$$;
      create schema cron;create table cron.job(jobid bigint generated always as identity,jobname text unique,schedule text,command text);
      create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command)values($1,$2,$3)on conflict(jobname)do update set schedule=$2,command=$3 returning jobid$$;`);
    db.install('supabase/fix_phase3_scheduler.sql');db.install('supabase/fix_phase3_scheduler.sql');
    assert.equal(sql('select count(*) from cron.job;').stdout.trim(),'1');
    sql('select public._invoke_notification_worker();');
    assert.equal(sql("select headers->>'x-cron-secret'='synthetic-cron-secret' from net.calls;").stdout.trim(),'t');
    fail('set role authenticated;select public._invoke_notification_worker();',/permission denied/);
  });
  console.log(`\n${passed} Phase 3 local database checks passed. Scheduler transport was mocked; nothing contacted a hosted service.`);
} finally { db.close(); }
