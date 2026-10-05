// Tests the screenshot-specific, user-confirmed TEST-DATA cleanup locally only.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { localTestDatabase } from './local-test-db.mjs';
const db=await localTestDatabase(),sql=db.sql,read=file=>readFileSync(file,'utf8');
const doctor='58b6b969-6c23-48e2-a53a-86a3a21b5f46',keeper='a843e54b-6e38-4c87-bfa8-23d5d3a94507';
const remove=['0ba71514-0449-4a29-a536-cfe95022fc64','434ce046-33ac-4b7a-a1b2-f84933cfd0f1','6427b941-b05e-4c43-8336-45f9983cebe7'];
const actor='00000000-0000-0000-0000-000000000001',patient='10000000-0000-0000-0000-000000000001',other='20000000-0000-0000-0000-000000000001';
const reconciliation=read('supabase/reconcile_test_monday_schedules.sql');
const snapshot=()=>sql(`select jsonb_build_object(${['profiles','patients','doctors','appointments','patient_visit_notes','audit_log','doctor_unavailable_dates'].map(t=>`'${t}',(select jsonb_agg(to_jsonb(r) order by id) from public.${t} r)`).join(',')});`).stdout;
const scheduleSnapshot=()=>sql('select jsonb_agg(to_jsonb(s) order by id) from public.doctor_schedules s;').stdout;
const grid=()=>sql(`select array_agg(distinct x order by x) from public.doctor_schedules s cross join lateral generate_series(date '2030-10-07'+s.start_time,date '2030-10-07'+s.end_time-make_interval(mins=>s.slot_duration_minutes),make_interval(mins=>s.slot_duration_minutes)) x where doctor_id='${doctor}' and day_of_week=1;`).stdout;
const checks=[];function test(name,fn){fn();checks.push(name);console.log('PASS '+name);}
try{
 const original=spawnSync('git',['show','HEAD:supabase/schema.sql'],{encoding:'utf8',windowsHide:true});assert.equal(original.status,0);sql(original.stdout);db.install('supabase/fix_phase1_security.sql');
 sql(`insert into auth.users values('${actor}');insert into public.profiles(id,full_name,role)values('${actor}','Synthetic Admin','admin');
 insert into public.patients(id,full_name)values('${patient}','Synthetic Patient');insert into public.doctors(id,full_name)values('${doctor}','Synthetic Target Doctor'),('${other}','Synthetic Other Doctor');
 insert into public.doctor_schedules(id,doctor_id,day_of_week,start_time,end_time,slot_duration_minutes)values
 ('${keeper}','${doctor}',1,'08:00','17:00',30),${remove.map((id,i)=>`('${id}','${doctor}',1,'${9+i}:00','17:00',30)`).join(',')};
 insert into public.doctor_schedules(doctor_id,day_of_week,start_time,end_time)values('${other}',1,'09:00','12:00');
 insert into public.appointments(patient_id,doctor_id,scheduled_time,status,created_by)values('${patient}','${doctor}','2030-10-07T01:00:00Z','scheduled','${actor}');
 insert into public.patient_visit_notes(patient_id,appointment_id,note,created_by)select patient_id,id,'Synthetic preserved note','${actor}' from public.appointments;`);
 test('Existing six overlap pairs abort Phase 2 unchanged',()=>{const before=scheduleSnapshot(),r=sql(read('supabase/fix_phase2_booking_availability.sql'),'phase3_test',true);assert.notEqual(r.status,0);assert.match(r.stderr,/6 duplicate\/overlapping pair/);assert.equal(scheduleSnapshot(),before);});
 test('Changed keeper aborts without deleting schedules',()=>{sql(`update public.doctor_schedules set start_time='08:30' where id='${keeper}';`);const before=scheduleSnapshot();assert.notEqual(sql(reconciliation,'phase3_test',true).status,0);assert.equal(scheduleSnapshot(),before);sql(`update public.doctor_schedules set start_time='08:00' where id='${keeper}';`);});
 test('Unexpected referencing table aborts rather than cascading',()=>{sql('create table public.synthetic_schedule_reference(id uuid primary key references public.doctor_schedules(id) on delete cascade);');const before=scheduleSnapshot();assert.notEqual(sql(reconciliation,'phase3_test',true).status,0);assert.equal(scheduleSnapshot(),before);sql('drop table public.synthetic_schedule_reference;');});
 const before=snapshot(),slots=grid(),oid=sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout;
 test('Exact cleanup privately archives three rows and preserves keeper, slot grid, unrelated schedules and every clinical row',()=>{
  sql(reconciliation);assert.equal(snapshot(),before);assert.equal(grid(),slots);assert.equal(sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout,oid);
  assert.equal(sql(`select count(*) from public.doctor_schedules where doctor_id='${doctor}';`).stdout.trim(),'1');assert.equal(sql(`select count(*) from public.doctor_schedules where doctor_id='${other}';`).stdout.trim(),'1');
  assert.equal(sql('select count(*) from medicappointment_maintenance.schedule_reconciliation_archive;').stdout.trim(),'3');
  for(const role of ['anon','authenticated','service_role'])assert.notEqual(sql(`set role ${role};select * from medicappointment_maintenance.schedule_reconciliation_archive;`,'phase3_test',true).status,0);
 });
 test('Repeated cleanup is harmless; Phase 2 then Phase 3 install and preserve all clinical rows',()=>{
  sql(reconciliation);assert.equal(snapshot(),before);db.install('supabase/fix_phase2_booking_availability.sql');db.install('supabase/fix_phase3_notifications_reports.sql');assert.equal(snapshot(),before);
  sql(reconciliation);assert.equal(snapshot(),before);assert.equal(sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout,oid);
  assert.equal(sql('select count(*) from medicappointment_maintenance.schedule_reconciliation_archive;').stdout.trim(),'3');
 });
 writeFileSync('scripts/schedule-reconciliation-results.json',JSON.stringify({timestamp:new Date().toISOString(),boundary:'Disposable synthetic loopback PostgreSQL only; no hosted execution',checks:checks.map(name=>({name,result:'PASS'}))},null,2)+'\n');
 console.log(checks.length+' local reconciliation checks passed. No hosted database contacted.');
}finally{db.close();}
