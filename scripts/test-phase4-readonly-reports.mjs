// Reproduce PostgREST's read-only report transaction using disposable local SQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localTestDatabase } from './local-test-db.mjs';
import { verifyReportPages } from './test-phase4-report-ui.mjs';

const read = file => readFileSync(file,'utf8');
const canonical = read('supabase/fix_phase3_notifications_reports.sql');
const marker = '-- BEGIN CANONICAL PHASE 3 OPERATIONS';
const endMarker = '-- END CANONICAL PHASE 3 OPERATIONS';
const phase3 = source => source.slice(source.indexOf(marker),source.indexOf(endMarker)+endMarker.length);
for (const file of ['supabase/schema.sql','supabase/full.sql','supabase/migrate_patient_booking.sql','supabase/full_demo.sql']) {
  assert.equal(phase3(read(file)),phase3(canonical), `${file} must include the current canonical report fix`);
}
const patch = read('supabase/fix_phase4_readonly_report_auth.sql');
assert.equal(read('supabase/fix_admin_reports_readonly.sql'), patch, 'Earlier patch filename must remain compatible.');
const reportStart = patch.indexOf('create or replace function public.staff_appointment_report(');
const definition = name => {
  const start=patch.indexOf('create or replace function public.'+name+'(');
  assert.ok(start>=0,name+' definition missing');
  return patch.slice(start,patch.indexOf('end $$;',start)+'end $$;'.length);
};
const reportDefinitions=['staff_appointment_report','staff_report_audit'].map(definition);
for (const body of reportDefinitions) assert.ok(canonical.includes(body),'Existing-database patch must match the canonical report definition.');
const definitions = reportDefinitions.join('\n');
const readGuard = '  perform public._require_admin_readonly();';
assert.equal(definitions.split(readGuard).length-1,2);
const legacyDefinitions = definitions.replaceAll(readGuard,'  perform public._require_admin();');
const duplicateDefinition = patch.slice(patch.indexOf('create or replace function public.admin_patient_duplicate_count('),reportStart).trim();
assert.ok(canonical.includes(duplicateDefinition));
const legacyDuplicate = duplicateDefinition.replace('plpgsql stable','plpgsql').replaceAll('_require_admin_readonly()','_require_admin()');
const db = await localTestDatabase();
const sql = db.sql;
const uid = { admin:'00000000-0000-4000-8000-000000000001', patient:'00000000-0000-4000-8000-000000000002', missing:'00000000-0000-4000-8000-000000000003' };
const pa='10000000-0000-4000-8000-000000000001',pb='10000000-0000-4000-8000-000000000002';
const da='20000000-0000-4000-8000-000000000001',dbId='20000000-0000-4000-8000-000000000002';
const day='2030-10-10';
const instant = (date,time) => `(timestamp '${date} ${time}' at time zone 'Asia/Manila')`;
const request = (actor,query,zone='UTC',role='authenticated') => `begin read only; set local role ${role};
  set local request.jwt.claim.sub='${uid[actor] || ''}'; set local timezone='${zone}'; ${query} commit;`;
const json = query => JSON.parse(sql(query).stdout.trim());
const denied = (query,pattern) => { const r=sql(query,'phase3_test',true); assert.notEqual(r.status,0); assert.match(r.stderr,pattern); };
const report = `select public.staff_appointment_report('${day}','${day}');`;
const audit = `select public.staff_report_audit('${day}','${day}','readonly_fixture',0,100);`;
const duplicate = `select public.admin_patient_duplicate_count('Same Name',null,'09123456789');`;
const snapshot = () => sql(`select md5(jsonb_build_object(
  'profiles',(select jsonb_agg(to_jsonb(t) order by id) from public.profiles t),
  'patients',(select jsonb_agg(to_jsonb(t) order by id) from public.patients t),
  'doctors',(select jsonb_agg(to_jsonb(t) order by id) from public.doctors t),
  'schedules',(select jsonb_agg(to_jsonb(t) order by id) from public.doctor_schedules t),
  'unavailable',(select jsonb_agg(to_jsonb(t) order by id) from public.doctor_unavailable_dates t),
  'appointments',(select jsonb_agg(to_jsonb(t) order by id) from public.appointments t),
  'notes',(select jsonb_agg(to_jsonb(t) order by id) from public.patient_visit_notes t),
  'audit',(select jsonb_agg(to_jsonb(t) order by id) from public.audit_log t),
  'versions',(select jsonb_agg(to_jsonb(t) order by appointment_id) from public.appointment_notification_versions t),
  'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notification_attempts t)
)::text);`).stdout.trim();
try {
  db.install('supabase/schema.sql');
  const rows=[['00:30','scheduled','walk_in',pa,da],['09:00','pending','pre_booked',pa,da],
    ['09:30','checked_in','walk_in',pb,dbId],['10:00','waiting','pre_booked',pa,da],
    ['10:30','in_progress','pre_booked',pb,dbId],['11:00','completed','walk_in',pa,da],
    ['11:30','no_show','pre_booked',pa,da],['11:30','no_show','pre_booked',pb,dbId],
    ['12:30','no_show','pre_booked',pa,da],['12:30','no_show','pre_booked',pb,dbId]];
  sql(`insert into auth.users values ${Object.values(uid).map(id=>`('${id}')`).join(',')};
    insert into public.profiles(id,full_name,role) values ('${uid.admin}','Synthetic Admin','admin'),('${uid.patient}','Synthetic Patient','patient');
    insert into public.patients(id,user_id,full_name) values ('${pa}','${uid.patient}','Same Name'),('${pb}',null,'Same Name');
    insert into public.doctors(id,full_name) values ('${da}','Same Doctor'),('${dbId}','Same Doctor');
    insert into public.appointments(patient_id,doctor_id,scheduled_time,status,source) values
      ${rows.map(([time,status,source,patient,doctor])=>`('${patient}','${doctor}',${instant(day,time)},'${status}','${source}')`).join(',')};
    insert into public.appointments(patient_id,doctor_id,scheduled_time,status)
      select '${pa}','${da}',${instant(day,'12:00')},'cancelled' from generate_series(1,1201);
    insert into public.appointments(patient_id,doctor_id,scheduled_time,status) values
      ('${pa}','${da}',${instant('2030-10-09','23:59')},'cancelled'),('${pa}','${da}',${instant('2030-10-11','00:00')},'cancelled');
    insert into public.audit_log(action,entity,entity_id,created_at)
      select 'readonly_fixture','appointment','${pa}',${instant(day,'00:30')} from generate_series(1,185);`);

  sql(legacyDefinitions + '\n' + legacyDuplicate);
  // Reconstruct an existing pre-fix database where the new helper is absent.
  sql('drop function public._require_admin_readonly();');
  for (const query of [report,audit,duplicate]) denied(request('admin',query),/cannot execute SELECT FOR SHARE in a read-only transaction/);
  console.log('PASS reproduced the exact read-only error in both legacy reports and duplicate counting');
  const before = snapshot();
  const mutationGuard = sql("select pg_get_functiondef('public._require_admin()'::regprocedure);").stdout;
  const unchangedCatalog = () => sql(`select jsonb_build_object(
    'functions',(select jsonb_agg(pg_get_functiondef(p.oid) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f' and p.proname not in ('_require_admin_readonly','staff_appointment_report','staff_report_audit','admin_patient_duplicate_count')),
    'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
    'tables',(select jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relrowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
    'index',(select jsonb_build_array(oid,pg_get_indexdef(oid)) from pg_class where oid='public.uq_doctor_slot'::regclass));`).stdout;
  const catalogBefore = unchangedCatalog();
  db.install('supabase/fix_phase4_readonly_report_auth.sql');
  db.install('supabase/fix_phase4_readonly_report_auth.sql');
  assert.equal(snapshot(),before);
  assert.equal(unchangedCatalog(),catalogBefore);
  assert.equal(sql("select pg_get_functiondef('public._require_admin()'::regprocedure);").stdout,mutationGuard);
  assert.match(mutationGuard,/for share/i);
  console.log('PASS patch is repeatable, preserves all records and retains mutation role locks');

  for (const zone of ['UTC','Asia/Manila','America/New_York']) {
    const result=json(request('admin',report,zone));
    assert.equal(result.total,1211); assert.equal(result.noShows,4); assert.equal(result.cancelled,1201); assert.equal(result.walkIns,3);
    assert.deepEqual(result.perDay,{[day]:1211}); assert.equal(result.perDoctor.length,2);
    assert.deepEqual(result.perDoctor.map(d=>d.total).sort((a,b)=>a-b),[4,1207]);
    assert.equal(result.noShowPatients.length,2);
    const filtered=json(request('admin',`select public.staff_appointment_report('${day}','${day}','${dbId}');`,zone));
    assert.equal(filtered.total,4);
    const empty=json(request('admin',"select public.staff_appointment_report('2030-10-12','2030-10-12');",zone));
    assert.equal(empty.total,0); assert.deepEqual(empty.perDay,{});
    const month=json(request('admin',"select public.staff_appointment_report('2030-10-01','2030-10-31');",zone));
    assert.equal(month.total,1213); assert.equal(month.perDay[day],1211);
    const first=json(request('admin',audit,zone));
    const second=json(request('admin',`select public.staff_report_audit('${day}','${day}','readonly_fixture',100,100);`,zone));
    assert.equal(first.total,185); assert.equal(first.rows.length,100); assert.equal(second.rows.length,85);
    assert.equal(new Set([...first.rows,...second.rows].map(x=>x.id)).size,185);
  }
  assert.equal(json(request('admin',duplicate)),0);
  assert.equal(snapshot(),before);
  console.log('PASS read-only Dashboard calendar, report totals, filters and audit pagination in three timezones');

  for (const actor of ['patient','missing','']) for (const query of [report,audit,duplicate]) {
    denied(request(actor,query),/Administrator authorization required/);
  }
  for (const query of [report,audit,duplicate]) denied(request('',query,'UTC','anon'),/permission denied/);
  for (const query of ["select public.staff_appointment_report(null,'2030-10-10');",
    "select public.staff_appointment_report('2030-10-10','2030-10-01');",
    "select public.staff_report_audit('2030-10-10','2030-10-10',null,-1,100);"]) {
    denied(request('admin',query),/valid inclusive report range|Invalid audit report/);
  }
  sql(`update public.profiles set role='patient' where id='${uid.admin}';`);
  for (const query of [report,audit,duplicate]) denied(request('admin',query),/Administrator authorization required/);
  sql(`update public.profiles set role='admin' where id='${uid.admin}';`);
  assert.deepEqual(json(`select jsonb_agg(provolatile::text order by proname) from pg_proc
    where oid in ('public.staff_appointment_report(date,date,uuid)'::regprocedure,'public.staff_report_audit(date,date,text,integer,integer)'::regprocedure,'public.admin_patient_duplicate_count(text,date,text)'::regprocedure,'public._require_admin_readonly()'::regprocedure);`),['s','s','s','s']);
  console.log('PASS admin-only authorization, demoted/missing users, anonymous denial and validation in read-only transactions');

  for (const role of ['anon','authenticated']) {
    denied(`set role ${role}; select public._require_admin_readonly();`,/permission denied/);
  }
  const helper = json(`select jsonb_build_object('definer',prosecdef,'config',proconfig,'body',prosrc)
    from pg_proc where oid='public._require_admin_readonly()'::regprocedure;`);
  assert.equal(helper.definer,true);
  assert.ok(helper.config.includes('search_path=""'));
  assert.match(helper.body,/public\.profiles[\s\S]*auth\.uid\(\)[\s\S]*role = 'admin'/);
  const functions = json(`select jsonb_agg(jsonb_build_object('name',p.proname,'body',p.prosrc,'volatility',p.provolatile))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.prokind='f' and l.lanname in ('sql','plpgsql');`);
  const inspected = new Set();
  function checkReadGraph(fn) {
    if (inspected.has(fn.name)) return;
    inspected.add(fn.name);
    assert.match(fn.volatility,/^[si]$/,fn.name+' calls a non-read-only function');
    assert.doesNotMatch(fn.body,/\bfor\s+(share|update|no\s+key\s+update|key\s+share)\b|\b(insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i,fn.name);
    for (const call of fn.body.matchAll(/public\.([a-z_]+)\s*\(/gi)) {
      const target=functions.find(f=>f.name===call[1]);
      assert.ok(target,'Resolve public call '+call[1]);
      checkReadGraph(target);
    }
  }
  for (const fn of functions.filter(f=>/^[si]$/.test(f.volatility))) checkReadGraph(fn);
  console.log(`PASS all ${inspected.size} STABLE/IMMUTABLE public functions and their call graphs are free of row locks/writes; private helper ACL/search_path checked`);

  const writable = (actor,query) => `begin; set local role authenticated; set local request.jwt.claim.sub='${uid[actor]}'; ${query} commit;`;
  for (const query of [`update public.profiles set role='admin' where id='${uid.patient}';`,
    `select public.admin_set_profile_role('${uid.patient}','admin');`]) denied(writable('patient',query),/permission denied|Administrator authorization required/);
  for (const actor of ['patient','admin']) for (const query of [
    `update public.appointments set status='completed' where patient_id='${pa}';`,
    `delete from public.appointments where patient_id='${pa}';`,
    `insert into public.appointments(patient_id,doctor_id,scheduled_time) values('${pa}','${da}',${instant(day,'13:00')});`
  ]) denied(writable(actor,query),/permission denied/);
  denied(writable('patient',`create temporary table profiles(id uuid,role text);
    insert into profiles values('${uid.patient}','admin'); set local search_path=pg_temp,public; ${report}`),/Administrator authorization required/);
  denied(`insert into public.appointments(patient_id,doctor_id,scheduled_time) values('${pa}','${da}',${instant(day,'00:30')});`,/uq_doctor_slot/);
  assert.equal(snapshot(),before);
  console.log('PASS patient role escalation, profile shadowing and direct appointment writes denied; exact-slot duplicate still rejected');

  // A second session can acquire an exclusive actor row lock during reads,
  // but cannot do so while an actual protected mutation remains uncommitted.
  async function whileHeld(name,query,readOnly,probe) {
    const held = db.concurrent(`begin ${readOnly?'read only':''}; set local application_name='${name}';
      set local role authenticated; set local request.jwt.claim.sub='${uid.admin}';
      ${query} select pg_sleep(5); rollback;`);
    try {
      const deadline=Date.now()+5000;
      while (sql(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event='PgSleep';`).stdout.trim()!=='1') {
        assert.ok(Date.now()<deadline,'Timed out waiting for controlled transaction '+name);
        await new Promise(done=>setTimeout(done,25));
      }
      probe();
    } finally {
      const result=await held;
      assert.equal(result.status,0,result.stderr);
    }
  }
  const exclusive = `begin; select id from public.profiles where id='${uid.admin}' for update nowait; rollback;`;
  await whileHeld('phase4_read_without_actor_lock',report+audit+duplicate,true,()=>sql(exclusive));
  const appointmentId=sql(`select id from public.appointments where doctor_id='${da}' and scheduled_time=${instant(day,'00:30')};`).stdout.trim();
  await whileHeld('phase4_write_retains_actor_lock',`select public.staff_cancel_appointment('${appointmentId}');`,false,
    ()=>denied(exclusive,/could not obtain lock on row in relation "profiles"/));
  assert.equal(snapshot(),before);
  assert.equal(unchangedCatalog(),catalogBefore);
  console.log('PASS reports take no actor row lock; protected cancellation still holds the Phase 1 role lock until transaction end');

  db.install('supabase/fix_phase3_notifications_reports.sql');
  assert.equal(json(request('admin',report)).total,1211);
  assert.equal(json(request('admin',audit)).total,185);
  assert.equal(snapshot(),before);
  console.log('PASS canonical Phase 3 upgrade retains the read-only fix and leaves records intact');
  await verifyReportPages(db, uid);
  console.log('14 Phase 4 read-only report regression groups passed (8 SQL/security and 6 mounted portal checks). Hosted Supabase NOT VERIFIED.');
} finally {
  db.close();
}
