import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { localTestDatabase } from './local-test-db.mjs';

// Disposable synthetic loopback database only. Never reads .env or hosted data.
const db=await localTestDatabase(), sql=db.sql;
const read=file=>readFileSync(file,'utf8');
const correction=read('supabase/reconcile_test_blank_patient_names.sql');
const named='10000000-0000-0000-0000-000000000099';
const admin='00000000-0000-0000-0000-000000000001';
const linked='00000000-0000-0000-0000-000000000002';
const target='10000000-0000-0000-0000-000000000001';
const tables=['profiles','doctors','doctor_schedules','doctor_unavailable_dates','appointments','patient_visit_notes','audit_log'];
const history=()=>sql(`select jsonb_build_object(${tables.map(t=>`'${t}',(select jsonb_agg(to_jsonb(r) order by id) from public.${t} r)`).join(',')});`).stdout;
const patients=()=>sql('select jsonb_agg(to_jsonb(p) order by id) from public.patients p;').stdout;
const metadata=()=>sql("select jsonb_agg(to_jsonb(p)-'full_name' order by id) from public.patients p;").stdout;
const checks=[];
const test=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
const fail=pattern=>{const r=sql(correction,'phase3_test',true);assert.notEqual(r.status,0);assert.match(r.stderr,pattern);};
try {
  const original=spawnSync('git',['show','HEAD:supabase/schema.sql'],{encoding:'utf8',windowsHide:true});
  assert.equal(original.status,0);sql(original.stdout);
  db.install('supabase/fix_phase1_security.sql');db.install('supabase/fix_phase2_booking_availability.sql');
  sql(`insert into auth.users values('${admin}'),('${linked}');
    insert into public.profiles(id,full_name,role) values('${admin}','Synthetic Admin','admin'),('${linked}','Synthetic Linked Profile','patient');
    insert into public.patients(id,full_name,contact_number,date_of_birth,address)
      select ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,case when i%2=0 then '   ' else '' end,
        '09123456789',date '2000-01-01','Synthetic Address' from generate_series(1,14)i;
    update public.patients set user_id='${linked}' where id='${target}';
    insert into public.patients(id,full_name) values('${named}','Synthetic Existing Named Patient');
    insert into public.doctors(id,full_name) values('20000000-0000-0000-0000-000000000001','Synthetic Doctor');
    insert into public.doctor_schedules(doctor_id,day_of_week,start_time,end_time,slot_duration_minutes)
      values('20000000-0000-0000-0000-000000000001',1,'08:00','17:00',30);
    insert into public.appointments(patient_id,doctor_id,scheduled_time,status,created_by)
      values('${target}','20000000-0000-0000-0000-000000000001','2030-10-07T01:00:00Z','scheduled','${admin}');
    insert into public.patient_visit_notes(patient_id,appointment_id,note,created_by)
      select patient_id,id,'Synthetic preserved history','${admin}' from public.appointments;`);
  test('Phase 3 rejects original 14 blank names without modifying records',()=>{
    const before=patients(),r=sql(read('supabase/fix_phase3_notifications_reports.sql'),'phase3_test',true);
    assert.notEqual(r.status,0);assert.match(r.stderr,/14 invalid patient demographic/);assert.equal(patients(),before);
  });
  test('Unexpected blank count aborts without modifications',()=>{
    sql(`update public.patients set full_name='Synthetic Temporarily Named' where id='${target}';`);
    const before=patients();fail(/expected exactly 14 blank names, found 13/);assert.equal(patients(),before);
    sql(`update public.patients set full_name='' where id='${target}';`);
  });
  test('Other invalid fields abort rather than clearing demographics',()=>{
    sql(`update public.patients set contact_number='invalid' where id='${named}';`);
    const before=patients();fail(/other invalid demographics/);assert.equal(patients(),before);
    sql(`update public.patients set contact_number=null where id='${named}';`);
  });
  test('Unreviewed update triggers abort without bypassing triggers',()=>{
    sql("create function public.synthetic_update_guard() returns trigger language plpgsql as $$begin return new;end$$; create trigger synthetic_update_guard before update on public.patients for each row execute function public.synthetic_update_guard();");
    const before=patients();fail(/UPDATE triggers\/rules/);assert.equal(patients(),before);
    sql('drop trigger synthetic_update_guard on public.patients;drop function public.synthetic_update_guard();');
  });
  test('Existing synthetic-label collision aborts safely',()=>{
    sql(`update public.patients set full_name='TEST PATIENT ${target}' where id='${named}';`);
    const before=patients();fail(/generated label already exists/);assert.equal(patients(),before);
    sql(`update public.patients set full_name='Synthetic Existing Named Patient' where id='${named}';`);
  });
  const beforeHistory=history(),beforeMetadata=metadata();
  const beforeNamed=sql(`select to_jsonb(p) from public.patients p where id='${named}';`).stdout;
  const oid=sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout;
  test('Only 14 blank names change; private backups, IDs, auth links, named records and history preserved',()=>{
    sql(correction);assert.equal(history(),beforeHistory);assert.equal(metadata(),beforeMetadata);
    assert.equal(sql(`select to_jsonb(p) from public.patients p where id='${named}';`).stdout,beforeNamed);
    assert.equal(sql("select count(*) from public.patients where full_name='TEST PATIENT '||id::text;").stdout.trim(),'14');
    assert.equal(sql("select count(*) from medicappointment_maintenance.blank_patient_name_archive where btrim(original_name)='';").stdout.trim(),'14');
    for(const role of ['anon','authenticated','service_role'])assert.notEqual(sql(`set role ${role};select * from medicappointment_maintenance.blank_patient_name_archive;`,'phase3_test',true).status,0);
    assert.equal(sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout,oid);
  });
  test('Phase 3 installs after correction; reruns do not change records or ledger history',()=>{
    const before=patients();sql(correction);assert.equal(patients(),before);
    db.install('supabase/fix_phase3_notifications_reports.sql');assert.equal(history(),beforeHistory);assert.equal(patients(),before);
    sql(correction);assert.equal(patients(),before);assert.equal(history(),beforeHistory);
    assert.equal(sql('select count(*) from medicappointment_maintenance.blank_patient_name_archive;').stdout.trim(),'14');
    assert.equal(sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout,oid);
  });
  writeFileSync('scripts/blank-patient-name-reconciliation-results.json',JSON.stringify({timestamp:new Date().toISOString(),boundary:'Disposable synthetic loopback PostgreSQL only; no hosted execution',checks:checks.map(name=>({name,result:'PASS'}))},null,2)+'\n');
  console.log(`${checks.length} local checks passed. No hosted database contacted.`);
} finally {db.close();}
