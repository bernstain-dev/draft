// Independent count oracle for final reports; synthetic loopback database only.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { localTestDatabase } from './local-test-db.mjs';
const db=await localTestDatabase(),sql=db.sql;
const admin='00000000-0000-0000-0000-000000000001';
const pa='10000000-0000-0000-0000-000000000001',pb='10000000-0000-0000-0000-000000000002';
const da='20000000-0000-0000-0000-000000000001',dbId='20000000-0000-0000-0000-000000000002';
const instant=(date,time)=>`timestamp '${date} ${time}' at time zone 'Asia/Manila'`;
const day='2030-10-10';
const rows=[['00:30','scheduled','walk_in',pa,da],['09:00','pending','pre_booked',pa,da],['09:30','checked_in','walk_in',pb,dbId],['10:00','waiting','pre_booked',pa,da],['10:30','in_progress','pre_booked',pb,dbId],['11:00','completed','walk_in',pa,da],['11:30','no_show','pre_booked',pa,da],['11:30','no_show','pre_booked',pb,dbId],['12:30','no_show','pre_booked',pa,da],['12:30','no_show','pre_booked',pb,dbId]];
const as=text=>JSON.parse(sql(`set role authenticated;set request.jwt.claim.sub='${admin}';${text}`).stdout.trim());
try{
 db.install('supabase/schema.sql');sql(`insert into auth.users values('${admin}');insert into public.profiles(id,full_name,role)values('${admin}','Synthetic Admin','admin');
 insert into public.patients(id,full_name)values('${pa}','Identical Patient'),('${pb}','Identical Patient');insert into public.doctors(id,full_name)values('${da}','Identical Doctor'),('${dbId}','Identical Doctor');
 insert into public.appointments(patient_id,doctor_id,scheduled_time,status,source)values ${rows.map(([time,status,source,patient,doctor])=>`('${patient}','${doctor}',${instant(day,time)},'${status}','${source}')`).join(',')};
 insert into public.appointments(patient_id,doctor_id,scheduled_time,status)select '${pa}','${da}',${instant(day,'12:00')},'cancelled' from generate_series(1,1201);
 insert into public.appointments(patient_id,doctor_id,scheduled_time,status)values('${pa}','${da}',${instant('2030-10-09','23:59')},'cancelled'),('${pa}','${da}',${instant('2030-10-11','00:00')},'cancelled');
 insert into public.audit_log(action,entity,entity_id,created_at)select 'phase4_fixture','appointment','${pa}',${instant(day,'00:30')} from generate_series(1,185);`);
 for(const zone of ['Asia/Manila','UTC','America/New_York']){
  const report=as(`set timezone='${zone}';select public.staff_appointment_report('${day}','${day}');`);
  assert.equal(report.total,1211);assert.equal(report.noShows,4);assert.equal(report.cancelled,1201);assert.equal(report.walkIns,3);assert.deepEqual(report.perDay,{[day]:1211});
  assert.equal(report.perDoctor.length,2);assert.deepEqual(report.perDoctor.map(x=>x.total).sort((a,b)=>a-b),[4,1207]);assert.equal(report.noShowPatients.length,2);assert.equal(new Set(report.noShowPatients.map(x=>x.id)).size,2);
  for(const p of report.noShowPatients)assert.equal(p.noShow,2);
  assert.equal(as(`select public.staff_appointment_report('${day}','${day}','${dbId}');`).total,4);
  const empty=as("select public.staff_appointment_report('2030-10-12','2030-10-12');");assert.equal(empty.total,0);assert.deepEqual(empty.perDay,{});assert.deepEqual(empty.perDoctor,[]);
  const page1=as(`select public.staff_report_audit('${day}','${day}','phase4_fixture',0,100);`),page2=as(`select public.staff_report_audit('${day}','${day}','phase4_fixture',100,100);`);
  assert.equal(page1.total,185);assert.equal(page1.rows.length,100);assert.equal(page2.rows.length,85);assert.equal(new Set([...page1.rows,...page2.rows].map(x=>x.id)).size,185);
 }
 writeFileSync('scripts/phase4-report-count-results.json',JSON.stringify({timestamp:new Date().toISOString(),result:'PASS',fixture:{total:1211,noShows:4,cancelled:1201,walkIns:3,perDoctorTotals:[4,1207],sameNameDoctorIds:2,sameNameFlaggedPatientIds:2,auditTotal:185,auditPages:[100,85],allEightStatuses:true},timezones:['Asia/Manila','UTC','America/New_York'],boundary:'Disposable local SQL, synthetic only; no REST row cap; no hosted access'},null,2)+'\n');
 console.log('PASS Phase 4 report oracle: 1211 total / 4 no-shows / 1201 cancelled / 3 walk-ins; eight statuses, ID isolation, clinic midnight, doctor/empty filters and audit 100+85 under three SQL timezones.');
}finally{db.close();}
