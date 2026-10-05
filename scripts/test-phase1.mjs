// Integration tests in an ephemeral local PostgreSQL cluster ONLY.
// No Supabase URL/keys, project .env, production connection or seeded people.
// Requires initdb, pg_ctl and psql on PATH, or PG_BIN pointing to their folder.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/fix_phase1_security.sql');
const schema = read('supabase/schema.sql');
const full = read('supabase/full.sql');
const legacy = read('supabase/migrate_patient_booking.sql');
const canonical = (s) => s.slice(s.indexOf('-- BEGIN CANONICAL PHASE 1 SECURITY'),
  s.indexOf('-- END CANONICAL PHASE 1 SECURITY') + '-- END CANONICAL PHASE 1 SECURITY'.length);
let passed = 0;
function test(name, callback) {
  callback();
  passed++;
  console.log(`PASS ${name}`);
}
test('installation and upgrade files have identical security operations', () => {
  for (const sql of [schema, full, legacy]) assert.equal(canonical(sql), canonical(migration));
});
test('browser appointment mutation paths are RPC-only', () => {
  for (const path of ['src/pages/patient/BookAppointment.tsx', 'src/pages/patient/MyAppointments.tsx',
    'src/pages/appointments/Booking.tsx', 'src/pages/appointments/CheckIn.tsx']) {
    assert.doesNotMatch(read(path), /\.from\(['"]appointments['"]\)\s*\.(insert|update|delete|upsert)\(/);
    assert.doesNotMatch(read(path), /isMissingRpc/);
  }
});
test('only safe profile fields are sent by patient registration; role management uses RPC', () => {
  assert.doesNotMatch(read('src/pages/patient/auth/patientAuth.tsx'), /\.insert\(\{[^}]*role:/);
  assert.match(read('src/pages/appointments/Settings.tsx'), /rpc\('admin_set_profile_role'/);
});
test('existing verification cannot trigger production writes from environment', () => {
  assert.doesNotMatch(read('scripts/verify.mjs'), /createClient|process\.env|\.delete\(|\.insert\(/);
});

// Resolve binaries without ever reading or printing environment credentials.
const ext = process.platform === 'win32' ? '.exe' : '';
let pgBin = process.env.PG_BIN;
if (!pgBin) {
  const found = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['psql'], { encoding: 'utf8' });
  if (found.status !== 0) throw new Error('Local PostgreSQL binaries missing. Set PG_BIN; no remote fallback is allowed.');
  pgBin = dirname(found.stdout.trim().split(/\r?\n/)[0]);
}
const binary = (name) => join(pgBin, name + ext);
for (const name of ['initdb', 'pg_ctl', 'psql']) {
  assert.ok(existsSync(binary(name)), `Local ${name} missing; no remote fallback is allowed.`);
}
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PG/i.test(k)));
const temporaryRoot = resolve(mkdtempSync(join(tmpdir(), 'medicappointment-phase1-')));
assert.ok(temporaryRoot.startsWith(resolve(tmpdir()) + sep));
const dataDirectory = join(temporaryRoot, 'data');
const logFile = join(temporaryRoot, 'postgres.log');
const port = await new Promise((res, rej) => {
  const probe = net.createServer();
  probe.once('error', rej);
  probe.listen(0, '127.0.0.1', () => {
    const value = probe.address().port;
    probe.close(() => res(value));
  });
});
const run = (name, args, input) => spawnSync(binary(name), args, {
  input, encoding: 'utf8', env: childEnv, timeout: 60000, maxBuffer: 8 * 1024 * 1024,
  windowsHide: true,
});
const psqlArgs = (database) => ['-X', '-h', '127.0.0.1', '-p', String(port),
  '-U', 'phase1_test_owner', '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atq'];
const sql = (text, database = 'upgrade_test', allowError = false) => {
  const result = run('psql', psqlArgs(database), text);
  if (!allowError && result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Local SQL failed.');
  return result;
};
const uid = { admin: '00000000-0000-0000-0000-000000000001', a: '00000000-0000-0000-0000-000000000002',
  b: '00000000-0000-0000-0000-000000000003', registration: '00000000-0000-0000-0000-000000000004',
  missing: '00000000-0000-0000-0000-000000000005', admin2: '00000000-0000-0000-0000-000000000006' };
const patientA = '10000000-0000-0000-0000-000000000001';
const patientB = '10000000-0000-0000-0000-000000000002';
const doctor = '20000000-0000-0000-0000-000000000001';
const inactiveDoctor = '20000000-0000-0000-0000-000000000002';
const oldA = '30000000-0000-0000-0000-000000000001';
const oldB = '30000000-0000-0000-0000-000000000002';
const oldCompleted = '30000000-0000-0000-0000-000000000003';
const slot = (days, time = '09:00') => `(((now() at time zone 'Asia/Manila')::date + ${days}) + time '${time}') at time zone 'Asia/Manila'`;
const actorSql = (actor, statement) => `set role authenticated; set request.jwt.claim.sub = '${uid[actor]}'; ${statement}`;
const as = (actor, statement, allowError = false, database = 'upgrade_test') => sql(actorSql(actor, statement), database, allowError);
const denied = (actor, statement, pattern = /permission denied|authorization required|Appointment not found|Only upcoming|no longer|can cancel only|Invalid appointment status transition|clinic date|Only scheduled|already been booked|whole-minute|not a valid|unavailable|not available|future date|Invalid role|own administrative role|Follow-up appointment|record missing/i) => {
  const result = as(actor, statement, true);
  assert.notEqual(result.status, 0, 'Unauthorized/invalid operation succeeded.');
  assert.match(result.stderr, pattern);
};
const book = (actor, days, time = '09:00', selectedDoctor = doctor) => {
  const call = actor === 'admin' || actor === 'admin2'
    ? `public.staff_book_appointment('${patientA}', '${selectedDoctor}', ${slot(days, time)})`
    : `public.book_appointment('${selectedDoctor}', ${slot(days, time)}, 'Synthetic reason')`;
  return JSON.parse(as(actor, `select ${call};`).stdout).id;
};
const snapshot = () => sql(`select jsonb_build_object(
  'profiles', (select jsonb_agg(to_jsonb(t) order by id) from public.profiles t),
  'patients', (select jsonb_agg(to_jsonb(t) order by id) from public.patients t),
  'doctors', (select jsonb_agg(to_jsonb(t) order by id) from public.doctors t),
  'schedules', (select jsonb_agg(to_jsonb(t) order by id) from public.doctor_schedules t),
  'appointments', (select jsonb_agg(to_jsonb(t) order by id) from public.appointments t),
  'notes', (select jsonb_agg(to_jsonb(t) order by id) from public.patient_visit_notes t),
  'audit', (select jsonb_agg(to_jsonb(t) order by id) from public.audit_log t));`).stdout;
const concurrent = (actor, statement) => new Promise((res, rej) => {
  const process = spawn(binary('psql'), psqlArgs('upgrade_test'), { env: childEnv, windowsHide: true });
  let stdout = '', stderr = '';
  process.stdout.on('data', (chunk) => stdout += chunk);
  process.stderr.on('data', (chunk) => stderr += chunk);
  process.once('error', rej);
  process.once('exit', (status) => res({ status, stdout, stderr }));
  // Hold the winning transaction open so competing index checks overlap.
  process.stdin.end(actorSql(actor, `begin; select pg_sleep(0.5); ${statement} select pg_sleep(0.5); commit;`));
});
const racing = async (name, requests) => {
  const results = await Promise.all(requests.map(([actor, statement]) => concurrent(actor, statement)));
  assert.equal(results.filter((r) => r.status === 0).length, 1, `${name}: exactly one request must succeed.`);
  assert.equal(results.filter((r) => /already been booked/.test(r.stderr)).length, 1);
  passed++;
  console.log(`PASS ${name}`);
};

let started = false;
try {
  const init = run('initdb', ['-D', dataDirectory, '-U', 'phase1_test_owner', '-A', 'trust', '--no-sync', '--encoding=UTF8']);
  assert.equal(init.status, 0, init.error?.message || init.stderr);
  const start = run('pg_ctl', ['-D', dataDirectory, '-l', logFile, '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  assert.equal(start.status, 0, start.error?.message || start.stderr);
  started = true;
  sql('create role anon; create role authenticated; create role service_role bypassrls;', 'postgres');
  for (const database of ['upgrade_test','fresh_test','full_test','legacy_test']) sql(`create database ${database};`, 'postgres');
  const auth = `create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;`;
  for (const database of ['upgrade_test','fresh_test','full_test','legacy_test']) sql(auth, database);
  // Simulate the audited deployed version, not the newly edited schema.
  const oldSchema = spawnSync('git', ['show', 'HEAD:supabase/schema.sql'], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(oldSchema.status, 0, 'Audited schema baseline unavailable from Git.');
  sql(oldSchema.stdout);
  sql(`insert into auth.users values ${Object.values(uid).map((id) => `('${id}')`).join(',')};
    insert into public.profiles (id, full_name, role) values
      ('${uid.admin}', 'Synthetic Admin', 'admin'), ('${uid.admin2}', 'Synthetic Admin Two', 'admin'),
      ('${uid.a}', 'Synthetic Patient A', 'patient'), ('${uid.b}', 'Synthetic Patient B', 'patient'),
      ('${uid.missing}', 'Synthetic Missing Patient', 'patient');
    insert into public.patients (id, user_id, full_name) values
      ('${patientA}', '${uid.a}', 'Synthetic Patient A'), ('${patientB}', '${uid.b}', 'Synthetic Patient B');
    insert into public.doctors (id, full_name, is_active) values
      ('${doctor}', 'Synthetic Active Doctor', true), ('${inactiveDoctor}', 'Synthetic Inactive Doctor', false);
    insert into public.doctor_schedules (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
      select '${doctor}', d, '08:00', '17:00', 30 from generate_series(0,6) d;
    insert into public.appointments (id, patient_id, doctor_id, scheduled_time, status, created_by) values
      ('${oldA}', '${patientA}', '${doctor}', ${slot(5,'08:00')}, 'scheduled', '${uid.a}'),
      ('${oldB}', '${patientB}', '${doctor}', ${slot(5,'08:30')}, 'pending', '${uid.b}'),
      ('${oldCompleted}', '${patientA}', '${doctor}', ${slot(-1,'08:00')}, 'completed', '${uid.admin}');
    insert into public.patient_visit_notes (patient_id, appointment_id, note) values
      ('${patientA}', '${oldCompleted}', 'Synthetic historical note');
    -- Test unknown permissive legacy policies and column grants, not just known names.
    create policy forgotten_open_write on public.appointments for all using (true) with check (true);
    grant update (role) on public.profiles to authenticated;
    grant update (status) on public.appointments to authenticated;
    grant all on all tables in schema public to service_role;`);
  const before = snapshot();
  const slotIndexOid = sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout;
  test('G: migration preserves every existing profile, patient, doctor, schedule, appointment, note and audit row', () => {
    sql(migration);
    assert.equal(snapshot(), before);
    assert.equal(sql("select 'public.uq_doctor_slot'::regclass::oid;").stdout, slotIndexOid);
  });
  test('migration is repeatable without rewriting history or existing rows', () => {
    sql(migration);
    assert.equal(snapshot(), before);
  });
  test('fresh schema and one-click schema both execute safely in local empty databases', () => {
    sql(schema, 'fresh_test');
    sql(full, 'full_test'); // Demonstration rows remain inside this disposable database only.
    sql(schema, 'fresh_test');
  });
  test('legacy upgrade executes atomically and includes Phase 1 protections', () => {
    sql(oldSchema.stdout, 'legacy_test');
    sql(`alter table public.appointments add column queue_number integer;
      alter table public.appointments add column is_priority boolean;
      alter table public.profiles drop constraint profiles_role_check;
      alter table public.profiles add constraint profiles_role_check check (role in ('admin','receptionist','doctor','board'));`, 'legacy_test');
    sql(legacy, 'legacy_test');
    assert.equal(sql(`select has_column_privilege('authenticated','public.profiles','role','UPDATE');`, 'legacy_test').stdout.trim(), 'f');
    // Legacy queue columns remain historical, so the legacy upgrade stays
    // repeatable. Its fresh-schema guard rejects the separate clean fixture.
    sql(legacy, 'legacy_test');
    const clean = sql(legacy, 'fresh_test', true);
    assert.notEqual(clean.status, 0);
    assert.match(clean.stderr, /Fresh.*schema detected/);
  });
  test('A: patient cannot update role, assign role at signup, or invoke administrative role assignment', () => {
    denied('a', `update public.profiles set role = 'admin' where id = '${uid.a}';`);
    denied('registration', `insert into public.profiles (id, full_name, role) values ('${uid.registration}','Synthetic Signup','admin');`);
    denied('a', `select public.admin_set_profile_role('${uid.a}', 'admin');`);
    assert.equal(sql(`select role from public.profiles where id = '${uid.a}';`).stdout.trim(), 'patient');
  });
  test('B: permitted profile fields remain editable; other patient profiles remain inaccessible', () => {
    as('a', `update public.profiles set full_name = 'Synthetic Updated A', device_label = 'Synthetic Device' where id = '${uid.a}';`);
    assert.equal(sql(`select full_name from public.profiles where id = '${uid.a}';`).stdout.trim(), 'Synthetic Updated A');
    assert.equal(as('a', `update public.profiles set full_name = 'Unauthorized' where id = '${uid.b}' returning id;`).stdout.trim(), '');
  });
  test('new signup receives database-default patient role and can create its own linked patient row', () => {
    as('registration', `insert into public.profiles (id, full_name) values ('${uid.registration}','Synthetic Signup');
      insert into public.patients (user_id, full_name) values ('${uid.registration}', 'Synthetic Signup');`);
    assert.equal(as('registration', 'select role from public.profiles;').stdout.trim(), 'patient');
  });
  test('authorized admin role assignment remains functional; self-demotion/unknown role are rejected', () => {
    as('admin', `select public.admin_set_profile_role('${uid.registration}', 'admin');`);
    assert.equal(sql(`select role from public.profiles where id = '${uid.registration}';`).stdout.trim(), 'admin');
    as('admin', `select public.admin_set_profile_role('${uid.registration}', 'patient');`);
    denied('admin', `select public.admin_set_profile_role('${uid.admin}', 'patient');`);
    denied('admin', `select public.admin_set_profile_role('${uid.a}', 'owner');`);
    denied('admin', `update public.profiles set role = 'admin' where id = '${uid.a}';`);
  });
  test('C: patients and browser admins cannot directly INSERT/UPDATE/DELETE appointments', () => {
    for (const actor of ['a','admin']) {
      for (const status of ['checked_in','completed','cancelled','scheduled'])
        denied(actor, `update public.appointments set status = '${status}' where id = '${oldA}';`);
      denied(actor, `insert into public.appointments (patient_id,doctor_id,scheduled_time) values ('${patientA}','${doctor}',${slot(7)});`);
      denied(actor, `update public.appointments set doctor_id = '${inactiveDoctor}', scheduled_time = ${slot(7)} where id = '${oldA}';`);
      denied(actor, `delete from public.appointments where id = '${oldA}';`);
    }
  });
  test('D: approved patient booking derives ownership, actor and fixed scheduled status', () => {
    const id = book('a', 10);
    assert.equal(sql(`select patient_id = '${patientA}' and created_by = '${uid.a}' and status = 'scheduled'
      from public.appointments where id = '${id}';`).stdout.trim(), 't');
    assert.equal(as('b', `select id from public.appointments where id = '${id}';`).stdout.trim(), '');
    denied('b', `select public.reschedule_appointment('${id}', '${doctor}', ${slot(11)});`);
    denied('b', `select public.cancel_appointment('${id}');`);
    denied('missing', `select public.book_appointment('${doctor}', ${slot(11)});`);
  });
  test('E: staff booking applies the same authoritative schedule checks and writes reason/note atomically', () => {
    const result = JSON.parse(as('admin', `select public.staff_book_appointment('${patientA}','${doctor}',${slot(11)},'walk_in','Room A','Synthetic visit reason');`).stdout);
    assert.equal(sql(`select count(*) from public.patient_visit_notes where appointment_id = '${result.id}';`).stdout.trim(), '1');
    denied('a', `select public.staff_book_appointment('${patientB}','${doctor}',${slot(12)});`);
    for (const actor of ['a','admin']) {
      const rpc = (time, doc = doctor) => actor === 'a'
        ? `select public.book_appointment('${doc}', ${time});`
        : `select public.staff_book_appointment('${patientA}', '${doc}', ${time});`;
      denied(actor, rpc(slot(-1)));
      denied(actor, rpc(slot(12,'09:01')));
      denied(actor, rpc(slot(12,'17:00')));
      denied(actor, rpc(slot(12,'09:00:01')));
      denied(actor, rpc(slot(12), inactiveDoctor));
      denied(actor, rpc('null'));
    }
    sql(`insert into public.doctor_unavailable_dates (doctor_id,date) values ('${doctor}', (now() at time zone 'Asia/Manila')::date + 12);`);
    denied('a', `select public.book_appointment('${doctor}',${slot(12)});`);
    denied('admin', `select public.staff_book_appointment('${patientA}','${doctor}',${slot(12)});`);
  });
  test('F: uq_doctor_slot still blocks sequential exact duplicates, including direct trusted backend inserts', () => {
    book('a', 13);
    denied('b', `select public.book_appointment('${doctor}',${slot(13)});`);
    denied('admin', `select public.staff_book_appointment('${patientA}','${doctor}',${slot(13)});`);
    const result = sql(`insert into public.appointments (patient_id,doctor_id,scheduled_time) values ('${patientB}','${doctor}',${slot(13)});`, 'upgrade_test', true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /uq_doctor_slot/);
  });
  await racing('concurrent patient/patient same-slot requests: one winner', [
    ['a', `select public.book_appointment('${doctor}',${slot(14)});`],
    ['b', `select public.book_appointment('${doctor}',${slot(14)});`],
  ]);
  await racing('concurrent patient/staff same-slot requests: one winner', [
    ['a', `select public.book_appointment('${doctor}',${slot(15)});`],
    ['admin', `select public.staff_book_appointment('${patientB}','${doctor}',${slot(15)});`],
  ]);
  await racing('concurrent staff/staff same-slot requests: one winner', [
    ['admin', `select public.staff_book_appointment('${patientA}','${doctor}',${slot(16)});`],
    ['admin2', `select public.staff_book_appointment('${patientB}','${doctor}',${slot(16)});`],
  ]);
  test('rescheduling validates ownership/status/slot and failure preserves original appointment', () => {
    const original = sql(`select to_jsonb(a) from public.appointments a where id = '${oldA}';`).stdout;
    denied('a', `select public.reschedule_appointment('${oldA}','${doctor}',${slot(13)});`);
    assert.equal(sql(`select to_jsonb(a) from public.appointments a where id = '${oldA}';`).stdout, original);
    denied('a', `select public.reschedule_appointment('${oldA}','${doctor}',${slot(17,'09:01')});`);
    as('a', `select public.reschedule_appointment('${oldA}','${doctor}',${slot(17)});`);
    as('admin', `select public.staff_reschedule_appointment('${oldB}','${doctor}',${slot(17,'09:30')});`);
    denied('a', `select public.staff_reschedule_appointment('${oldA}','${doctor}',${slot(18)});`);
    denied('admin', `select public.staff_reschedule_appointment('${oldCompleted}','${doctor}',${slot(18)});`);
  });
  const moveA = book('a', 18, '08:00'), moveB = book('b', 18, '08:30');
  await racing('concurrent patient/staff rescheduling into one slot: one winner', [
    ['a', `select public.reschedule_appointment('${moveA}','${doctor}',${slot(18)});`],
    ['admin', `select public.staff_reschedule_appointment('${moveB}','${doctor}',${slot(18)});`],
  ]);
  test('cancellation retains history, releases the exact slot and never revives terminal rows', () => {
    const id = book('a', 19);
    as('a', `select public.cancel_appointment('${id}');`);
    assert.equal(sql(`select status from public.appointments where id = '${id}';`).stdout.trim(), 'cancelled');
    assert.ok(book('b', 19));
    denied('a', `select public.reschedule_appointment('${id}','${doctor}',${slot(20)});`);
    denied('admin', `select public.staff_set_appointment_status('${id}','scheduled');`);
    denied('admin', `select public.staff_cancel_appointment('${oldCompleted}');`);
    const staffId = book('admin', 20);
    as('admin', `select public.staff_cancel_appointment('${staffId}');`);
    assert.ok(book('a', 20));
  });
  test('check-in and clinical progression require admin, clinic day, valid transitions and timestamp', () => {
    const today = '30000000-0000-0000-0000-000000000010';
    sql(`insert into public.appointments (id,patient_id,doctor_id,scheduled_time,status)
      values ('${today}','${patientA}','${doctor}',${slot(0,'08:00')},'scheduled');`);
    denied('a', `select public.staff_check_in_appointment('${today}');`);
    denied('a', `select public.staff_set_appointment_status('${today}','completed');`);
    denied('admin', `select public.staff_check_in_appointment('${oldA}');`);
    denied('admin', `select public.staff_set_appointment_status('${today}','completed');`);
    as('admin', `select public.staff_check_in_appointment('${today}','Room B');`);
    const checkedAt = sql(`select checked_in_at from public.appointments where id = '${today}';`).stdout.trim();
    assert.ok(checkedAt);
    as('admin', `select public.staff_check_in_appointment('${today}','Different room');`);
    assert.equal(sql(`select checked_in_at from public.appointments where id = '${today}';`).stdout.trim(), checkedAt);
    denied('a', `select public.cancel_appointment('${today}');`);
    for (const status of ['waiting','in_progress','completed']) as('admin', `select public.staff_set_appointment_status('${today}','${status}');`);
    denied('admin', `select public.staff_check_in_appointment('${today}');`);
    denied('admin', `select public.staff_set_appointment_status('${today}','scheduled');`);
    denied('admin', `select public.staff_cancel_appointment('${today}');`);
    assert.equal(sql(`select count(*) from public.audit_log where entity_id = '${today}' and action = 'status_change';`).stdout.trim(), '4');
  });
  test('pending confirmation and no-show progression follow backend rules and retain no-show slot reuse', () => {
    as('admin', `select public.staff_set_appointment_status('${oldB}','scheduled');`);
    denied('admin', `select public.staff_set_appointment_status('${oldB}','no_show');`);
    const missed = '30000000-0000-0000-0000-000000000020';
    sql(`insert into public.appointments (id,patient_id,doctor_id,scheduled_time,status)
      values ('${missed}','${patientA}','${doctor}',${slot(-2,'08:00')},'scheduled');`);
    as('admin', `select public.staff_set_appointment_status('${missed}','no_show');`);
    denied('admin', `select public.staff_set_appointment_status('${missed}','checked_in');`, /authorized check-in/);
    const future = book('a', 22);
    // Trusted fixture creates an existing future no-show to verify the
    // unchanged index predicate, not to permit early no-show via the API.
    sql(`update public.appointments set status = 'no_show' where id = '${future}';`);
    assert.ok(book('b', 22));
  });
  test('function execution ACLs and search_path deny anonymous/private entry points and temporary-table shadowing', () => {
    const anonymous = sql(`set role anon; select public.book_appointment('${doctor}',${slot(21)});`, 'upgrade_test', true);
    assert.notEqual(anonymous.status, 0);
    denied('a', `select public._assert_slot_bookable('${doctor}',${slot(21)});`);
    denied('a', 'select public._require_admin();');
    denied('a', `select public._cancel_appointment('${oldA}',null);`);
    assert.equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'],false);`).stdout.trim(), '0');
    denied('a', `create temp table profiles (id uuid, role text); insert into profiles values ('${uid.a}','admin');
      set search_path = pg_temp,public; select public.admin_set_profile_role('${uid.b}','admin');`);
    assert.equal(sql(`select has_table_privilege('service_role','public.appointments','INSERT');`).stdout.trim(), 't');
  });
  console.log(`\n${passed} checks passed. All database writes used synthetic data on loopback PostgreSQL only.`);
} finally {
  if (started) {
    const stop = run('pg_ctl', ['-D', dataDirectory, '-m', 'fast', '-w', 'stop']);
    if (stop.status !== 0) throw new Error('Temporary PostgreSQL could not be stopped; retained its directory for inspection.');
  }
  // Verify the absolute deletion target remains this generated temp folder.
  const target = resolve(temporaryRoot);
  assert.ok(target.startsWith(resolve(tmpdir()) + sep) && dirname(target) === resolve(tmpdir())
    && target.includes('medicappointment-phase1-'));
  rmSync(target, { recursive: true, force: true });
}
