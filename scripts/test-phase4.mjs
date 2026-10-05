// Release verification: synthetic disposable loopback PostgreSQL and mocked SMS only.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { localTestDatabase } from './local-test-db.mjs';
import { confirmationHandler, reminderHandler } from '../supabase/functions/_shared/handlers.ts';
import { csvText, csvCell } from '../src/lib/csv.ts';
const read = f => readFileSync(f,'utf8');
const db = await localTestDatabase(); const checks = [];
const id = { admin:'00000000-0000-0000-0000-000000000001', a:'00000000-0000-0000-0000-000000000002', b:'00000000-0000-0000-0000-000000000003' };
const pa='10000000-0000-0000-0000-000000000001', pb='10000000-0000-0000-0000-000000000002', doctor='20000000-0000-0000-0000-000000000001';
const sql=db.sql, json=r=>JSON.parse(r.stdout.trim()), q=v=>v===null?'null':typeof v==='number'||typeof v==='boolean'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const actor=(name,text)=>`set role authenticated; set request.jwt.claim.sub='${id[name]}'; ${text}`;
const as=(name,text)=>sql(actor(name,text));
const slot=(day,time='09:00')=>`timestamp '2030-10-${String(day).padStart(2,'0')} ${time}' at time zone 'Asia/Manila'`;
const tables=['profiles','patients','doctors','doctor_schedules','doctor_unavailable_dates','appointments','patient_visit_notes','audit_log'];
const snapshot=(database='phase3_test')=>sql(`select jsonb_build_object(${tables.map(t=>`${q(t)},(select jsonb_agg(to_jsonb(t) order by id) from public.${t} t)`).join(',')});`,database).stdout;
const deny=(text)=>{const r=sql(text,'phase3_test',true);assert.notEqual(r.status,0,'Unauthorized/invalid request succeeded');return r;};
async function test(name,fn){await fn();checks.push({name,result:'PASS'});console.log('PASS '+name);}
const shim=`create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`;
const fixtures=`insert into auth.users values ${Object.values(id).map(v=>`('${v}')`).join(',')};
 insert into public.profiles(id,full_name,role) values('${id.admin}','Synthetic Admin','admin'),('${id.a}','Identical Name','patient'),('${id.b}','Identical Name','patient');
 insert into public.patients(id,user_id,full_name,contact_number) values('${pa}','${id.a}','Identical Name','09123456789'),('${pb}','${id.b}','Identical Name','09123456789');
 insert into public.doctors(id,full_name,specialty) values('${doctor}','Synthetic Doctor','General');
 insert into public.doctor_schedules(doctor_id,day_of_week,start_time,end_time,slot_duration_minutes) select '${doctor}',day,'09:00','12:00',30 from generate_series(0,6)day;`;
const migrations=['supabase/fix_phase1_security.sql','supabase/fix_phase2_booking_availability.sql','supabase/fix_phase3_notifications_reports.sql','supabase/fix_phase4_readonly_report_auth.sql'];
try {
 await test('Complete fresh schema executes; ten tables, RLS, index, triggers and required public RPCs exist',()=>{
  db.install('supabase/schema.sql');sql(fixtures);
  const found=json(sql("select jsonb_object_agg(c.relname,c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';"));
  for(const t of [...tables,'appointment_notification_versions','notification_attempts'])assert.equal(found[t],true,t);
  const functions=['book_appointment','staff_book_appointment','reschedule_appointment','staff_reschedule_appointment','cancel_appointment','staff_cancel_appointment','staff_check_in_appointment','staff_set_appointment_status','admin_set_profile_role','ensure_patient_identity','admin_link_patient','get_available_appointment_slots','get_available_appointment_dates','staff_block_doctor_date','patient_save_profile','staff_appointment_report','staff_report_audit','queue_due_appointment_reminders','claim_appointment_notifications','finish_appointment_notification','record_notification_delivery'];
  for(const f of functions)assert.equal(sql(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=${q(f)};`).stdout.trim(),'1',f);
  assert.match(sql("select pg_get_indexdef('public.uq_doctor_slot'::regclass);").stdout,/UNIQUE.*doctor_id, scheduled_time.*cancelled.*no_show/);
  assert.ok(Number(sql("select count(*) from pg_trigger where not tgisinternal and tgrelid in(select oid from pg_class where relnamespace='public'::regnamespace);").stdout)>=7);
  const inventory=json(sql(`select jsonb_build_object('tables',(select jsonb_agg(relname order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'), 'indexes',(select jsonb_agg(indexname order by indexname) from pg_indexes where schemaname='public'), 'policies',(select jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'command',cmd) order by tablename,policyname) from pg_policies where schemaname='public'), 'triggers',(select jsonb_agg(tgname order by tgname) from pg_trigger where not tgisinternal and tgrelid in(select oid from pg_class where relnamespace='public'::regnamespace)));`));
  inventory.constraints=json(sql("select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text,c.conname) from pg_constraint c where c.connamespace='public'::regnamespace;"));
  inventory.rpcs=json(sql(`select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'securityDefiner',p.prosecdef,'settings',p.proconfig,'anonymousExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in(${functions.map(q).join(',')});`));
  writeFileSync('scripts/phase4-database-inventory.json',JSON.stringify(inventory,null,2)+'\n');
 });
 const original=spawnSync('git',['show','HEAD:supabase/schema.sql'],{encoding:'utf8',windowsHide:true});assert.equal(original.status,0);
 await test('Synthetic complete pre-upgrade database survives Phase 1 → 2 → 3 → read-only report fix with UUID/history/roles/notes/audit/index OID unchanged',()=>{
  sql('create database phase4_upgrade;','postgres');sql(shim,'phase4_upgrade');sql(original.stdout,'phase4_upgrade');sql(fixtures,'phase4_upgrade');
  sql(`insert into public.appointments(patient_id,doctor_id,scheduled_time,status,created_by) values('${pa}','${doctor}',${slot(1)},'completed','${id.admin}');
   insert into public.patient_visit_notes(patient_id,appointment_id,note,created_by) select patient_id,id,'Synthetic historical note','${id.admin}' from public.appointments;
   insert into public.doctor_unavailable_dates(doctor_id,date,reason) values('${doctor}','2030-11-10','Synthetic block');`,'phase4_upgrade');
  const before=snapshot('phase4_upgrade'),oid=sql("select 'public.uq_doctor_slot'::regclass::oid;",'phase4_upgrade').stdout;
  for(const f of migrations){sql(read(f),'phase4_upgrade');assert.equal(snapshot('phase4_upgrade'),before,f);assert.equal(sql("select 'public.uq_doctor_slot'::regclass::oid;",'phase4_upgrade').stdout,oid);}
  for(const f of migrations)sql(read(f),'phase4_upgrade');assert.equal(snapshot('phase4_upgrade'),before);
 });
 await test('Incrementally upgraded database authorizes both STABLE reports in read-only transactions while denying patient/anonymous/private-helper access',()=>{
  const report=`select public.staff_appointment_report('2030-10-01','2030-10-31');`;
  const audit=`select public.staff_report_audit('2030-10-01','2030-10-31');`;
  const request=(role,uid,statement)=>`begin read only;set local role ${role};set local request.jwt.claim.sub='${uid}';${statement}commit;`;
  assert.equal(json(sql(request('authenticated',id.admin,report),'phase4_upgrade')).total,1);
  assert.equal(json(sql(request('authenticated',id.admin,audit),'phase4_upgrade')).total,0);
  for(const statement of [report,audit])for(const [role,uid]of [['authenticated',id.a],['anon','']]){
   const r=sql(request(role,uid,statement),'phase4_upgrade',true);assert.notEqual(r.status,0);assert.match(r.stderr,/Administrator authorization required|permission denied/);
  }
  assert.equal(sql("select has_function_privilege('authenticated','public._require_admin_readonly()','EXECUTE') or has_function_privilege('anon','public._require_admin_readonly()','EXECUTE');",'phase4_upgrade').stdout.trim(),'f');
 });
 await test('Incompatible zero-duration, overlapping and invalid demographic fixtures fail safely without deleting/rewriting rows',()=>{
  for(const [name,bad,migrate] of [
   ['zero',`update doctor_schedules set slot_duration_minutes=0 where day_of_week=0;`,1],
   ['overlap',`insert into doctor_schedules(doctor_id,day_of_week,start_time,end_time) values('${doctor}',0,'09:15','10:15');`,1],
   ['blank',`update doctors set full_name='   ';`,2]]){
   const database='phase4_bad_'+name;sql(`create database ${database};`,'postgres');sql(shim,database);sql(original.stdout,database);sql(fixtures,database);
   sql(read(migrations[0]),database);if(migrate===2)sql(read(migrations[1]),database);sql(bad,database);
   const before=snapshot(database),result=sql(read(migrations[migrate]),database,true);assert.notEqual(result.status,0);assert.equal(snapshot(database),before);
  }
 });
 await test('Anonymous cannot read patient/private appointment tables, mutate appointments or execute private/admin/booking RPCs',()=>{
  for(const t of ['profiles','patients','appointments','notification_attempts']){const r=sql(`set role anon;select count(*) from public.${t};`,'phase3_test',true);assert.ok(r.status!==0||r.stdout.trim()==='0');}
  for(const s of [`update public.appointments set status='completed';`,`select public.book_appointment('${doctor}',${slot(10)});`,`select public.admin_set_profile_role('${id.a}','admin');`,`select public._require_admin();`])deny('set role anon;'+s);
 });
 let apptA,apptB;
 await test('Patient own reads and operations work; patient B data/mutations, clinical writes, staff booking, reports and ledger are denied',()=>{
  apptA=json(as('a',`select public.book_appointment('${doctor}',${slot(10)});`)).id;apptB=json(as('b',`select public.book_appointment('${doctor}',${slot(10,'09:30')});`)).id;
  assert.equal(as('a',`select count(*) from public.profiles where id='${id.a}';`).stdout.trim(),'1');assert.equal(as('a',`select count(*) from public.patients where id='${pb}';`).stdout.trim(),'0');assert.equal(as('a',`select count(*) from public.appointments where id='${apptB}';`).stdout.trim(),'0');
  const changed=as('a',`update public.patients set full_name='Forbidden' where id='${pb}' returning id;`).stdout.trim();assert.equal(changed,'');
  for(const statement of [`update public.appointments set status='completed' where id='${apptA}';`,`update public.appointments set status='checked_in' where id='${apptA}';`,`select public.cancel_appointment('${apptB}');`,`select public.reschedule_appointment('${apptB}','${doctor}',${slot(11)});`,`select public.staff_book_appointment('${pa}','${doctor}',${slot(11)});`,`select public.staff_appointment_report('2030-10-01','2030-10-31');`,`select public.claim_appointment_notifications();`])deny(actor('a',statement));
  assert.equal(as('a','select count(*) from public.notification_attempts;').stdout.trim(),'0');
  as('a',`select public.reschedule_appointment('${apptA}','${doctor}',${slot(11)});select public.cancel_appointment('${apptA}');`);
  assert.equal(as('a',`select status from public.appointments where id='${apptA}';`).stdout.trim(),'cancelled');
 });
 await test('Role escalation fails for UPDATE, INSERT, UPSERT, admin RPC, malformed UUID, extra RPC arguments and forged metadata',()=>{
  const attempts=[`update public.profiles set role='admin' where id='${id.a}';`,`insert into public.profiles(id,full_name,role) values('${id.a}','Forged','admin');`,`insert into public.profiles(id,full_name,role) values('${id.a}','Forged','admin') on conflict(id) do update set role=excluded.role;`,`select public.admin_set_profile_role('${id.a}','admin');`,`select public.admin_set_profile_role('not-a-uuid','admin');`,`select public.ensure_patient_identity('Forged','admin');`];
  for(const s of attempts)deny(actor('a',s));
  as('a',`set request.jwt.claims='{"user_metadata":{"role":"admin"},"app_metadata":{"role":"admin"}}';select public.ensure_patient_identity('Identical Name');update public.profiles set device_label='Synthetic device' where id='${id.a}';`);
  assert.equal(as('a',`select role from public.profiles where id='${id.a}';`).stdout.trim(),'patient');
  assert.equal(as('a',`select device_label from public.profiles where id='${id.a}';`).stdout.trim(),'Synthetic device');
 });
 await test('Five concurrency combinations yield exactly one winner under the shared exact-slot rule',async()=>{
  const book=(who,day)=>who==='admin'?`select public.staff_book_appointment('${pa}','${doctor}',${slot(day)});`:`select public.book_appointment('${doctor}',${slot(day)});`;
  const race=async(day,requests)=>{const results=await Promise.all(requests.map(([who,s])=>db.concurrent('begin;'+actor(who,s)+'select pg_sleep(0.15);commit;')));assert.equal(results.filter(r=>r.status===0).length,1);assert.equal(sql(`select count(*) from public.appointments where doctor_id='${doctor}' and scheduled_time=${slot(day)} and status not in('cancelled','no_show');`).stdout.trim(),'1');};
  await race(12,[['a',book('a',12)],['b',book('b',12)]]);await race(13,[['a',book('a',13)],['admin',book('admin',13)]]);await race(14,[['admin',book('admin',14)],['admin',book('admin',14)]]);
  const moveA=json(as('a',book('a',15))).id;
  await race(16,[['a',`select public.reschedule_appointment('${moveA}','${doctor}',${slot(16)});`],['b',book('b',16)]]);
  const move1=json(as('a',book('a',17))).id,move2=json(as('b',book('b',18))).id;
  await race(19,[['a',`select public.reschedule_appointment('${move1}','${doctor}',${slot(19)});`],['b',`select public.reschedule_appointment('${move2}','${doctor}',${slot(19)});`]]);
 });
 await test('09:00:00 valid; seconds/fractions/off-grid rejected; cancelled and no-show slots released',()=>{
  const valid=json(as('a',`select public.book_appointment('${doctor}',${slot(20,'09:00:00')});`)).id;
  for(const time of ['09:00:01','09:00:00.500','09:01:00'])deny(actor('b',`select public.book_appointment('${doctor}',${slot(20,time)});`));
  as('a',`select public.cancel_appointment('${valid}');`);const next=json(as('b',`select public.book_appointment('${doctor}',${slot(20)});`)).id;
  // Trusted fixture mutation only, not a browser permission; tests index predicate/availability.
  sql(`update public.appointments set status='no_show' where id='${next}';`);assert.ok(json(as('a',`select public.book_appointment('${doctor}',${slot(20)});`)).success);
 });
 await test('Patient/staff availability is identical and private; inactive/blocked/full/completed/past rules apply',()=>{
  const avail=(who,day)=>json(as(who,`select coalesce(jsonb_agg(t),'[]') from public.get_available_appointment_slots('${doctor}','2030-10-${day}')t;`));
  const a=avail('a',10),admin=avail('admin',10);assert.deepEqual(a,admin);assert.equal(a.length,5);for(const row of a)assert.deepEqual(Object.keys(row).sort(),['scheduled_time','slot_duration_minutes']);
  as('admin',`select public.staff_block_doctor_date('${doctor}','2030-10-21');`);assert.deepEqual(avail('a',21),[]);
  const conflict=json(as('admin',`select public.staff_block_doctor_date('${doctor}','2030-10-20');`));
  assert.equal(conflict.success,false);assert.equal(conflict.conflict_count,1);
  assert.equal(sql(`select count(*) from public.doctor_unavailable_dates where doctor_id='${doctor}' and date='2030-10-20';`).stdout.trim(),'0');
  sql(`update public.doctors set is_active=false where id='${doctor}';`);assert.deepEqual(avail('a',22),[]);sql(`update public.doctors set is_active=true where id='${doctor}';`);
  sql(`insert into public.appointments(patient_id,doctor_id,scheduled_time,status) select '${pa}','${doctor}',(${slot(22)}+n*interval '30 minutes'),'completed' from generate_series(0,5)n;`);assert.deepEqual(avail('a',22),[]);
  assert.equal(as('a',`select count(*) from public.get_available_appointment_slots('${doctor}',(now() at time zone 'Asia/Manila')::date) where scheduled_time<=now();`).stdout.trim(),'0');
 });
 await test('Admin clinical progression works; terminal revival, future check-in and skipped transitions are rejected',()=>{
  const clinical=json(sql(`insert into public.appointments(patient_id,doctor_id,scheduled_time,status) values('${pa}','${doctor}',date_trunc('day',now() at time zone 'Asia/Manila') at time zone 'Asia/Manila','scheduled') returning to_jsonb(appointments);`)).id;
  as('admin',`select public.staff_check_in_appointment('${clinical}');`);
  for(const status of ['waiting','in_progress','completed'])as('admin',`select public.staff_set_appointment_status('${clinical}','${status}');`);
  assert.equal(sql(`select checked_in_at is not null from public.appointments where id='${clinical}';`).stdout.trim(),'t');
  deny(actor('admin',`select public.staff_set_appointment_status('${clinical}','cancelled');`));deny(actor('admin',`select public.staff_check_in_appointment('${apptB}');`));deny(actor('admin',`select public.staff_set_appointment_status('${apptB}','completed');`));
 });
 await test('Real notification handlers use actual local ledger; duplicate send, 400/429/500/timeout and persistence behavior are correct',async()=>{
  const rpcClient=who=>({auth:{getUser:async()=>({data:{user:id[who]?{id:id[who]}:null},error:null})},rpc:async(name,args={})=>{
   const argsSql=Object.entries(args).map(([k,v])=>`${k} => ${q(v)}`).join(',');const prefix=who==='service'?'set role service_role;':actor(who,'');
   const r=sql(`${prefix}select to_jsonb(public.${name}(${argsSql}));`,'phase3_test',true);return r.status===0?{data:r.stdout.trim()?JSON.parse(r.stdout):null,error:null}:{data:null,error:{code:/not authorized|authorization|required|permission denied/.test(r.stderr)?'42501':'P0001'}};
  }});
  let calls=0,mode=201;
  const deps={env:name=>({NOTIFY_ALLOWED_ORIGINS:'https://clinic.example.invalid',TWILIO_ACCOUNT_SID:'synthetic-account',TWILIO_AUTH_TOKEN:'synthetic-test-only',TWILIO_FROM_NUMBER:'+639000000000',CRON_SECRET:'synthetic-cron-only'}[name]),userClient:()=>rpcClient('a'),serviceClient:()=>rpcClient('service'),network:async()=>{calls++;if(mode==='timeout')throw new Error('Synthetic timeout');return new Response(JSON.stringify({sid:'SM'+calls.toString(16).padStart(32,'0')}),{status:mode});}};
  const handler=confirmationHandler(deps),request=appointment=>new Request('https://edge.example.invalid/send-confirmation',{method:'POST',headers:{Authorization:'Bearer synthetic-only',Origin:'https://clinic.example.invalid'},body:JSON.stringify({appointment_id:appointment})});
  const created=json(as('a',`select public.book_appointment('${doctor}',${slot(23)});`)).id;
  const first=await (await handler(request(created))).json();assert.equal(first.accepted,true);assert.equal(first.delivery,'not_verified');const count=calls;
  assert.equal((await (await handler(request(created))).json()).duplicate,true);assert.equal(calls,count);
  const event=sql(`select id from public.notification_attempts where appointment_id='${created}';`).stdout.trim();assert.equal(sql(`select status from public.notification_attempts where id='${event}';`).stdout.trim(),'accepted');
  sql(`set role service_role;select public.record_notification_delivery('SM${calls.toString(16).padStart(32,'0')}','delivered');`);assert.equal(sql(`select delivery_status from public.notification_attempts where id='${event}';`).stdout.trim(),'delivered');
  for(const [index,providerMode] of [400,429,500,'timeout'].entries()){
   mode=providerMode;const appointment=json(as('a',`select public.book_appointment('${doctor}',${slot(24+index)});`)).id;const r=await (await handler(request(appointment))).json();assert.equal(r.accepted,false);assert.equal(r.ok,false);assert.equal(sql(`select count(*) from public.appointments where id='${appointment}';`).stdout.trim(),'1');
   assert.equal(sql(`select status from public.notification_attempts where appointment_id='${appointment}';`).stdout.trim(),providerMode===500||providerMode==='timeout'?'unknown':'failed');
  }
  const preflight=await handler(new Request('https://edge.example.invalid',{method:'OPTIONS',headers:{Origin:'https://clinic.example.invalid'}}));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://clinic.example.invalid');
  const unauthorized=await reminderHandler(deps)(new Request('https://edge.example.invalid',{method:'POST'}));assert.equal(unauthorized.status,401);
 });
 await test('CSV neutralizes formulas/leading whitespace while preserving Unicode/quotes/commas/newlines',()=>{
  const dangerous=['=1+1','+SUM(A1:A2)','-10+20','@command','   +SUM(A1:A2)','\t=1+1'];for(const value of dangerous)assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('José 李'),'"José 李"');assert.equal(csvCell('a,"b"\nc'),'"a,""b""\nc"');assert.equal(csvCell(-10),'"-10"');
  writeFileSync('scripts/phase4-synthetic-export.csv',csvText(['Synthetic fixture'],[...dangerous,'José 李','a,"b"\nc'].map(v=>[v])));
 });
 writeFileSync('scripts/phase4-verification-results.json',JSON.stringify({timestamp:new Date().toISOString(),environment:'Disposable loopback PostgreSQL; synthetic auth.uid shim; mocked provider; no hosted access',checks},null,2)+'\n');
 console.log(`\n${checks.length} Phase 4 release checks passed. No hosted database/provider contacted.`);
}finally{db.close();}
