// Complete Phase 2 verification: mounted React tests plus synthetic loopback DB.
// Never accepts SUPABASE_URL, database URLs, production data or credentials.
import './test-phase2-ui.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root,file),'utf8');
const phase1 = read('supabase/fix_phase1_security.sql'), phase2 = read('supabase/fix_phase2_booking_availability.sql');
const markerStart = '-- BEGIN CANONICAL PHASE 2 AVAILABILITY', markerEnd = '-- END CANONICAL PHASE 2 AVAILABILITY';
const block = (text) => text.slice(text.indexOf(markerStart),text.indexOf(markerEnd)+markerEnd.length);
for (const file of ['supabase/schema.sql','supabase/full.sql','supabase/migrate_patient_booking.sql']) assert.equal(block(read(file)),block(phase2));
console.log('PASS Phase 2 canonical SQL matches fresh and legacy sources');
const ext = process.platform === 'win32' ? '.exe' : '';
const locate = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which',['psql'],{encoding:'utf8'});
const pgBin = process.env.PG_BIN || (locate.status === 0 ? dirname(locate.stdout.trim().split(/\r?\n/)[0]) : '');
for (const name of ['initdb','pg_ctl','psql']) assert.ok(existsSync(join(pgBin,name+ext)),`Local PostgreSQL ${name} required; no remote fallback.`);
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
const temporaryRoot = resolve(mkdtempSync(join(tmpdir(),'medicappointment-phase2-')));
const dataDirectory = join(temporaryRoot,'data');
const port = await new Promise((done,reject) => { const server = net.createServer(); server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{ const p=server.address().port; server.close(()=>done(p)); }); });
const run = (name,args,input) => spawnSync(join(pgBin,name+ext),args,{input,encoding:'utf8',env:childEnv,windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});
const args = (db) => ['-X','-h','127.0.0.1','-p',String(port),'-U','phase2_test_owner','-d',db,'-v','ON_ERROR_STOP=1','-Atq'];
const sql = (text,db='phase2_test',allowError=false) => { const r=run('psql',args(db),text); if(!allowError&&r.status!==0)throw new Error(r.error?.message||r.stderr); return r; };
const uid = {admin:'00000000-0000-0000-0000-000000000001',a:'00000000-0000-0000-0000-000000000002',b:'00000000-0000-0000-0000-000000000003',signup:'00000000-0000-0000-0000-000000000004',link:'00000000-0000-0000-0000-000000000005',race:'00000000-0000-0000-0000-000000000006'};
const doctor='20000000-0000-0000-0000-000000000001', inactive='20000000-0000-0000-0000-000000000002', todayDoctor='20000000-0000-0000-0000-000000000003';
const patientA='10000000-0000-0000-0000-000000000001',patientB='10000000-0000-0000-0000-000000000002',unlinked='10000000-0000-0000-0000-000000000003';
const date = (days) => `(now() at time zone 'Asia/Manila')::date + ${days}`;
const slot = (days,time='09:00') => `((${date(days)}) + time '${time}') at time zone 'Asia/Manila'`;
const actorSql = (actor,text) => `set role authenticated; set request.jwt.claim.sub='${uid[actor]}'; ${text}`;
const as = (actor,text,allowError=false) => sql(actorSql(actor,text),'phase2_test',allowError);
const json = (r) => JSON.parse(r.stdout.trim());
const available = (actor,days,doc=doctor) => json(as(actor,`select coalesce(jsonb_agg(to_jsonb(s) order by scheduled_time),'[]') from public.get_available_appointment_slots('${doc}',${date(days)}) s;`));
const denied = (actor,text,match) => { const r=as(actor,text,true);assert.notEqual(r.status,0);if(match)assert.match(r.stderr,match); };
const concurrent = (actor,text) => new Promise((done,reject)=>{
  const p=spawn(join(pgBin,'psql'+ext),args('phase2_test'),{env:childEnv,windowsHide:true});let stdout='',stderr='';
  p.stdout.on('data',(s)=>stdout+=s);p.stderr.on('data',(s)=>stderr+=s);p.once('error',reject);p.once('exit',(status)=>done({status,stdout,stderr}));
  p.stdin.end(actorSql(actor,`begin; select pg_sleep(0.3); ${text} select pg_sleep(0.3); commit;`));
});
let passed=0;
const test = async (name,body) => {await body();passed++;console.log(`PASS ${name}`);};
const snapshot = () => sql(`select jsonb_build_object(
  'patients',(select jsonb_agg(to_jsonb(p) order by id) from public.patients p),
  'doctors',(select jsonb_agg(to_jsonb(d) order by id) from public.doctors d),
  'schedules',(select jsonb_agg(to_jsonb(s) order by id) from public.doctor_schedules s),
  'unavailable',(select jsonb_agg(to_jsonb(u) order by id) from public.doctor_unavailable_dates u),
  'appointments',(select jsonb_agg(to_jsonb(a) order by id) from public.appointments a),
  'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),
  'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_log a));`).stdout;
let started=false;
try {
  const init=run('initdb',['-D',dataDirectory,'-U','phase2_test_owner','-A','trust','--no-sync','--encoding=UTF8']);assert.equal(init.status,0,init.stderr);
  const start=run('pg_ctl',['-D',dataDirectory,'-l',join(temporaryRoot,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);assert.equal(start.status,0,start.stderr);started=true;
  sql('create role anon; create role authenticated; create role service_role bypassrls;','postgres');
  const auth=`create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;`;
  const baseline=spawnSync('git',['show','HEAD:supabase/schema.sql'],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(baseline.status,0);
  for(const db of ['phase2_test','bad_schedule_test','bad_overlap_test','bad_appointment_test']) { sql(`create database ${db};`,'postgres'); sql(auth,db);sql(baseline.stdout,db);sql(phase1,db); }
  sql(`insert into auth.users values ${Object.values(uid).map(id=>`('${id}')`).join(',')};
    insert into public.profiles(id,full_name,role) values ('${uid.admin}','Synthetic Admin','admin'),('${uid.a}','Synthetic A','patient'),('${uid.b}','Synthetic B','patient');
    insert into public.patients(id,user_id,full_name) values ('${patientA}','${uid.a}','Synthetic A'),('${patientB}','${uid.b}','Synthetic B'),('${unlinked}',null,'Synthetic A');
    insert into public.doctors(id,full_name,is_active) values ('${doctor}','Synthetic Doctor',true),('${inactive}','Synthetic Inactive',false),('${todayDoctor}','Synthetic Today',true);
    insert into public.doctor_schedules(doctor_id,day_of_week,start_time,end_time,slot_duration_minutes)
      select '${doctor}',d,'08:00','17:00',30 from generate_series(0,6)d;
    insert into public.doctor_schedules(doctor_id,day_of_week,start_time,end_time,slot_duration_minutes)
      select '${todayDoctor}',d,'00:00','24:00',30 from generate_series(0,6)d;
    insert into public.appointments(patient_id,doctor_id,scheduled_time,status) values ('${patientB}','${doctor}',${slot(10)},'scheduled');`);
  const before=snapshot();const index=sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout;
  await test('Phase 2 migration preserves every existing valid row and exact-slot index identity; repeat application is safe',()=>{
    sql(phase2);assert.equal(snapshot(),before);assert.equal(sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout,index);
    sql(phase2);assert.equal(snapshot(),before);
    assert.equal(sql("select has_column_privilege('authenticated','public.profiles','role','UPDATE') or has_table_privilege('authenticated','public.appointments','UPDATE');").stdout.trim(),'f');
  });
  await test('A/B: patient availability hides another patient occupied slot while returning exactly the staff-safe fields',()=>{
    const a=available('a',10),b=available('b',10),staff=available('admin',10);
    assert.deepEqual(a,b);assert.deepEqual(a,staff);assert.equal(a.length,17);
    for(const s of a)assert.deepEqual(Object.keys(s).sort(),['scheduled_time','slot_duration_minutes']);
    assert.ok(!a.some(s=>Date.parse(s.scheduled_time)===Date.parse(sql(`select ${slot(10)};`).stdout.trim())));
    assert.equal(as('a',`select count(*) from public.appointments where patient_id='${patientB}';`).stdout.trim(),'0');
  });
  await test('empty and completely booked days have consistent availability in both portals',()=>{
    assert.equal(available('a',11).length,18);assert.deepEqual(available('a',11),available('admin',11));
    sql(`insert into public.appointments(patient_id,doctor_id,scheduled_time,status)
      select '${patientB}','${doctor}',g,'scheduled' from generate_series(${slot(12,'08:00')},${slot(12,'16:30')},interval '30 minutes')g;`);
    assert.deepEqual(available('a',12),[]);assert.deepEqual(available('admin',12),[]);
  });
  await test('C: seconds and fractional seconds cannot bypass approved booking operations',()=>{
    for(const time of ['09:00:01','09:00:00.500']){
      denied('a',`select public.book_appointment('${doctor}',${slot(13,time)});`,/whole-minute/);
      denied('admin',`select public.staff_book_appointment('${patientA}','${doctor}',${slot(13,time)});`,/whole-minute/);
    }
    as('a',`select public.book_appointment('${doctor}',${slot(13)});`);
    assert.equal(sql(`select extract(second from scheduled_time) from public.appointments where scheduled_time=${slot(13)};`).stdout.trim(),'0.000000');
    const trusted=sql(`insert into public.appointments(patient_id,doctor_id,scheduled_time) values ('${patientB}','${doctor}',${slot(13,'10:00:00.500')});`,'phase2_test',true);
    assert.notEqual(trusted.status,0);assert.match(trusted.stderr,/phase2_appointment_minute_check/);
  });
  await test('D/E: database rejects duplicate, overlapping, zero/negative/fractional duration and non-minute schedules',()=>{
    const base=`insert into public.doctor_schedules(doctor_id,day_of_week,start_time,end_time,slot_duration_minutes) values ('${doctor}',1,`;
    for(const [start,end,duration]of [['08:00','17:00',30],['16:30','18:00',30],['17:00','18:00',0],['17:00','18:00',-1],['17:00:01','18:00',30],['18:00','17:00',30],['17:00','18:00',61]])
      denied('admin',`${base}'${start}','${end}',${duration});`,/phase2_schedule|doctor_schedules_check/);
    denied('admin',`${base}'17:00','18:00','0.5');`,/invalid input syntax/);
    as('admin',`${base}'17:00','18:00',30);`); // Adjacent windows are allowed.
  });
  await test('invalid pre-existing schedules abort migration without deletion, cleanup or partial changes',()=>{
    for(const [db,duration]of [['bad_schedule_test',0],['bad_overlap_test',30]]){
      sql(`insert into public.doctors(id,full_name) values ('${doctor}','Synthetic Bad Doctor');
        insert into public.doctor_schedules(doctor_id,day_of_week,start_time,end_time,slot_duration_minutes)
          values ('${doctor}',1,'08:00','17:00',30),('${doctor}',1,'09:00','10:00',${duration});`,db);
      const original=sql('select jsonb_agg(to_jsonb(s) order by id) from public.doctor_schedules s;',db).stdout;
      const result=sql(phase2,db,true);assert.notEqual(result.status,0);assert.match(result.stderr,/Phase 2 aborted/);assert.match(result.stderr,/Overlapping schedule ID pairs/);
      assert.equal(sql('select jsonb_agg(to_jsonb(s) order by id) from public.doctor_schedules s;',db).stdout,original);
      assert.equal(sql("select count(*) from pg_constraint where conname like 'phase2_schedule%';",db).stdout.trim(),'0');
    }
  });
  await test('pre-existing non-minute appointment aborts migration without rounding or rewriting history',()=>{
    const db='bad_appointment_test';
    sql(`insert into public.patients(id,full_name) values ('${patientA}','Synthetic Legacy Patient');
      insert into public.doctors(id,full_name) values ('${doctor}','Synthetic Legacy Doctor');
      insert into public.appointments(patient_id,doctor_id,scheduled_time,status)
        values ('${patientA}','${doctor}',${slot(20,'09:00:00.500')},'completed');`,db);
    const original=sql('select jsonb_agg(to_jsonb(a) order by id) from public.appointments a;',db).stdout;
    const result=sql(phase2,db,true);
    assert.notEqual(result.status,0);assert.match(result.stderr,/Phase 2 aborted: 1 appointment timestamp/);
    assert.equal(sql('select jsonb_agg(to_jsonb(a) order by id) from public.appointments a;',db).stdout,original);
    assert.equal(sql("select count(*) from pg_constraint where conname like 'phase2_%';",db).stdout.trim(),'0');
  });
  await test('F: cancelled/no-show release slots; completed appointments still occupy their exact slot',()=>{
    sql(`insert into public.appointments(patient_id,doctor_id,scheduled_time,status) values
      ('${patientB}','${doctor}',${slot(14,'09:00')},'cancelled'),('${patientB}','${doctor}',${slot(14,'09:30')},'no_show'),('${patientB}','${doctor}',${slot(14,'10:00')},'completed');`);
    const slots=available('a',14).map(s=>Date.parse(s.scheduled_time));
    for(const time of ['09:00','09:30'])assert.ok(slots.includes(Date.parse(sql(`select ${slot(14,time)};`).stdout.trim())));
    assert.ok(!slots.includes(Date.parse(sql(`select ${slot(14,'10:00')};`).stdout.trim())));
    assert.deepEqual(available('a',14),available('admin',14));
  });
  await test('G: conflict count prevents date blocking; direct staff INSERT cannot bypass the trigger',()=>{
    const result=json(as('admin',`select public.staff_block_doctor_date('${doctor}',${date(10)},'Synthetic leave');`));
    assert.equal(result.success,false);assert.equal(result.conflict_count,1);
    assert.equal(sql(`select count(*) from public.doctor_unavailable_dates where doctor_id='${doctor}' and date=${date(10)};`).stdout.trim(),'0');
    denied('admin',`insert into public.doctor_unavailable_dates(doctor_id,date) values ('${doctor}',${date(10)});`,/1 appointments conflict/);
    denied('a',`select public.staff_block_doctor_date('${doctor}',${date(15)});`,/authorization/);
    as('admin',`select public.staff_block_doctor_date('${doctor}',${date(15)});`);
    assert.deepEqual(available('a',15),[]);assert.deepEqual(available('admin',15),[]);
  });
  await test('blocking vs booking race cannot leave both a new block and an active visit',async()=>{
    const [booking,blocking]=await Promise.all([
      concurrent('a',`select public.book_appointment('${doctor}',${slot(16)});`),
      concurrent('admin',`select public.staff_block_doctor_date('${doctor}',${date(16)});`),
    ]);
    assert.equal(blocking.status,0);const blocked=json(blocking);
    if(booking.status===0){assert.equal(blocked.success,false);assert.equal(blocked.conflict_count,1);}
    else{assert.match(booking.stderr,/unavailable/);assert.equal(blocked.success,true);}
    assert.equal(sql(`select count(*) from public.doctor_unavailable_dates u join public.appointments a
      on a.doctor_id=u.doctor_id and (a.scheduled_time at time zone 'Asia/Manila')::date=u.date
      where u.doctor_id='${doctor}' and u.date=${date(16)} and a.status not in ('cancelled','no_show');`).stdout.trim(),'0');
  });
  await test('today excludes past slots, inactive doctor has no slots and date calendar uses identical backend rules',()=>{
    const today=available('a',0,todayDoctor);const instant=Date.parse(sql('select now();').stdout.trim());
    assert.ok(today.every(s=>Date.parse(s.scheduled_time)>instant));assert.deepEqual(today,available('admin',0,todayDoctor));
    assert.deepEqual(available('a',17,inactive),[]);
    const days=json(as('a',`select jsonb_agg(to_jsonb(d)) from public.get_available_appointment_dates('${doctor}',${date(12)},4)d;`));
    assert.equal(days[0].available,false);assert.equal(days[1].available,true);assert.equal(days[3].available,false);
  });
  await test('patient identity provisioning preserves own links and never matches an unlinked namesake',()=>{
    const own=json(as('a',"select public.ensure_patient_identity('Synthetic different input name');"));assert.equal(own.patient.id,patientA);
    assert.equal(sql(`select user_id is null from public.patients where id='${unlinked}';`).stdout.trim(),'t');
    denied('a',`update public.patients set user_id='${uid.a}' where id='${unlinked}';`,/permission denied/);
    denied('admin',`update public.patients set user_id='${uid.link}' where id='${unlinked}';`,/permission denied/);
    const signup=json(as('signup',"select public.ensure_patient_identity('Synthetic A');"));assert.equal(signup.profile.role,'patient');assert.notEqual(signup.patient.id,unlinked);
    denied('admin',"select public.ensure_patient_identity('Synthetic Admin');",/not a patient/);
    denied('a',`select public.admin_link_patient('${uid.link}','${unlinked}');`,/authorization/);
    as('admin',`select public.admin_link_patient('${uid.link}','${unlinked}');`);
    assert.equal(sql(`select role from public.profiles where id='${uid.link}';`).stdout.trim(),'patient');
    assert.equal(json(as('link',"select public.ensure_patient_identity('Ignored name');")).patient.id,unlinked);
    denied('admin',`select public.admin_link_patient('${uid.a}','${unlinked}');`,/already has a patient record/);
  });
  await test('concurrent first patient identity resolution creates one record and returns the real committed link',async()=>{
    const [a,b]=await Promise.all([concurrent('race',"select public.ensure_patient_identity('Synthetic Signup');"),concurrent('race',"select public.ensure_patient_identity('Synthetic Signup');")]);
    assert.equal(a.status,0);assert.equal(b.status,0);assert.equal(json(a).patient.id,json(b).patient.id);
    assert.equal(sql(`select count(*) from public.patients where user_id='${uid.race}';`).stdout.trim(),'1');
  });
  await test('RPC privacy/role ACLs remain protected and schedule/slot instants are timezone independent in PostgreSQL',()=>{
    const guest=sql(`set role anon; select * from public.get_available_appointment_slots('${doctor}',${date(17)});`,'phase2_test',true);assert.notEqual(guest.status,0);assert.match(guest.stderr,/permission denied/);
    denied('a',`select * from public._clinic_schedule_slots('${doctor}',${date(17)});`,/permission denied/);
    const outputs=['Asia/Manila','UTC','America/New_York'].map(zone=>as('a',`set timezone='${zone}'; select jsonb_agg(extract(epoch from scheduled_time) order by scheduled_time) from public.get_available_appointment_slots('${doctor}',${date(18)});`).stdout);
    assert.equal(outputs[0],outputs[1]);assert.equal(outputs[0],outputs[2]);
    assert.equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'],false);`).stdout.trim(),'0');
  });
  console.log(`\n${passed} Phase 2 local database checks passed; mounted UI/timezone checks and canonical-copy verification also passed.`);
} finally {
  if(started){const stop=run('pg_ctl',['-D',dataDirectory,'-m','fast','-w','stop']);if(stop.status!==0)throw new Error('Temporary PostgreSQL could not stop; directory retained.');}
  const target=resolve(temporaryRoot);assert.ok(dirname(target)===resolve(tmpdir())&&target.startsWith(resolve(tmpdir())+sep)&&target.includes('medicappointment-phase2-'));
  rmSync(target,{recursive:true,force:true});
}
