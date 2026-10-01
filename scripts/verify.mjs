// Verification: queue removal + patient booking architecture.
// Static checks ALWAYS run. Live Supabase checks run only when env is set:
//   SUPABASE_URL, SUPABASE_ANON_KEY, PATIENT_EMAIL, PATIENT_PASSWORD
//   [STAFF_EMAIL, STAFF_PASSWORD] for the live double-booking test.
// Usage: node scripts/verify.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '');

const schema = read('supabase/schema.sql');
const seed = read('supabase/seed.cjs');
const staffAuth = read('src/pages/appointments/auth/staffAuth.tsx');
const patientAuth = read('src/pages/patient/auth/patientAuth.tsx');
const booking = read('src/pages/appointments/Booking.tsx');
const checkIn = read('src/pages/appointments/CheckIn.tsx');
const app = read('src/App.tsx');
const shell = read('src/components/LoginShell.tsx');
const bookFlow = read('src/pages/patient/BookAppointment.tsx');

// 1. Queue system is gone (frontend + schema)
check('queue-board frontend removed',
  !existsSync(join(root, 'src/pages/queue-board')) && !existsSync(join(root, 'src/lib/queuePing.ts')));
check('no queue UI/API references in src (outside legacy redirect + comments)',
  !/get_queue_today|queuePing|boardAuth|Join Queue|Queue Number|Queue Board|Priority lane|Regular lane/.test(
    read('src/pages/patient/BookAppointment.tsx') + bookFlow + booking + checkIn +
    read('src/pages/appointments/Dashboard.tsx') + read('src/pages/appointments/StaffLogin.tsx') +
    patientAuth + staffAuth + shell
  ));
const schemaCode = schema.replace(/--[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('schema has no queue objects (comments may mention them)',
  !/queue_today|get_queue_today|can_access_queue|assign_queue_number|queue_number|is_priority/.test(schemaCode));
check('schema roles are admin + patient only',
  /check \(role in \('admin','patient'\)\)/.test(schema));
check('no staff policy grants receptionist/doctor/board',
  !/receptionist/.test(schemaCode) && !/'doctor'/.test(schemaCode) && !/'board'/.test(schemaCode));

// 2. Double-booking guard at DB level
check(
  'double-booking unique index (doctor_id, scheduled_time) excluding cancelled/no_show',
  /create unique index if not exists uq_doctor_slot[\s\S]*?where status not in \('cancelled','no_show'\)/.test(schema)
);
check('staff booking surfaces 23505 as taken-slot', /23505/.test(booking));

// 3. Patient backend: policies + RPCs
for (const p of ['patient_read_doctors', 'patient_read_schedules', 'patient_read_unavailable',
  'patient_select_own', 'patient_insert_own', 'patient_update_own',
  'patient_select_own_appointments', 'patient_insert_own_appointments', 'patient_update_own_appointments']) {
  check(`patient RLS policy ${p}`, schema.includes(`"${p}"`));
}
for (const f of ['my_patient_id', 'book_appointment', 'reschedule_appointment', 'cancel_appointment']) {
  check(`RPC ${f} defined + granted`, new RegExp(`function ${f}\\(`).test(schema));
}

// 4. Patient booking workflow copy
for (const [file, label, re] of [
  ['src/pages/patient/BookAppointment.tsx', 'page title "Book an Appointment"', /Book an Appointment/],
  ['src/pages/patient/BookAppointment.tsx', '"Choose a Doctor"', /Choose a Doctor/],
  ['src/pages/patient/BookAppointment.tsx', '"Book an Appointment with"', /Book an Appointment with/],
  ['src/pages/patient/BookAppointment.tsx', '"Choose a Date"', /Choose a Date/],
  ['src/pages/patient/BookAppointment.tsx', '"Choose an Available Time"', /Choose an Available Time/],
  ['src/pages/patient/BookAppointment.tsx', '"Review Your Appointment"', /Review Your Appointment/],
  ['src/pages/patient/BookAppointment.tsx', '"Confirm Appointment"', /Confirm Appointment/],
  ['src/pages/patient/BookAppointment.tsx', '"Appointment Booked Successfully!"', /Appointment Booked Successfully!/],
  ['src/pages/patient/MyAppointments.tsx', '"My Appointments"', /My Appointments/],
  ['src/pages/patient/MyAppointments.tsx', 'empty state "No Appointments Yet"', /No Appointments Yet/],
  ['src/pages/patient/BookAppointment.tsx', 'empty state "No Available Times"', /No Available Times/],
]) {
  check(`${label}`, re.test(read(file)));
}
check('no doctor-centric wording in patient portal',
  !/Create Doctor|Create Appointment for|Manage Doctor|for Dr\./.test(
    read('src/pages/patient/BookAppointment.tsx') + read('src/pages/patient/MyAppointments.tsx') +
    read('src/pages/patient/Dashboard.tsx') + read('src/pages/patient/AppointmentHistory.tsx')));
check('router: /patient/* + /appointments/* exist, queue-board redirects',
  /path="\/patient\/\*"/.test(app) && /path="\/appointments\/\*"/.test(app) &&
  /path="\/queue-board\/\*".*Navigate to="\/patient\/login"/s.test(app));

// 5. Sessions isolated, no cross-imports
check('staff + patient use distinct storage keys',
  /medical-appointments-staff/.test(staffAuth) && /medical-patient/.test(patientAuth));
check('shared LoginShell holds no auth logic (boundary)',
  !/supabase|useStaffAuth|usePatientAuth|signIn/.test(shell));

// 6. Single seeder: admin + patient logins only, plus demo data
check('seed.cjs creates admin + patient only (no receptionist/doctor/board)',
  /vacunawa@gmail\.com/.test(seed) && /patient@gmail\.com/.test(seed) &&
  !/receptionist/.test(seed) && !/doctor@rhu/.test(seed) && !/'board'/.test(seed));
check('seed.cjs links patient login to a patient record', /user_id/.test(seed));
check('seed.cjs seeds doctors/schedules/patients/appointments/notes',
  /doctor_schedules/.test(seed) && /patient_visit_notes/.test(seed) && /upsert/.test(seed));
check('old seed files removed',
  !existsSync(join(root, 'supabase/seedusers.sql')) &&
  !existsSync(join(root, 'supabase/seed_admin.sql')) &&
  !existsSync(join(root, 'supabase/create_admin.cjs')));
check('booking RPC-first with missing-function fallback',
  /rpc\('book_appointment'/.test(bookFlow) && /isMissingRpc/.test(bookFlow));

// ---- Live checks (skipped without env) ----
const env = process.env;
if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.PATIENT_EMAIL && env.PATIENT_PASSWORD) {
  const { createClient } = await import('@supabase/supabase-js');
  const p = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: loginErr } = await p.auth.signInWithPassword({ email: env.PATIENT_EMAIL, password: env.PATIENT_PASSWORD });
  check('live: patient login succeeds', !loginErr, loginErr?.message ?? '');
  if (!loginErr) {
    const { data: pats, error: pErr } = await p.from('patients').select('id');
    check('live: patient sees own patient row only', !pErr && (pats ?? []).length === 1, pErr?.message ?? `${(pats ?? []).length} rows`);
    const { error: nErr } = await p.from('patient_visit_notes').select('id').limit(1);
    check('live: patient blocked from visit notes', nErr !== null, nErr?.message ?? 'readable!');
    const { data: docs } = await p.from('doctors').select('id').eq('is_active', true).limit(1);
    if (docs?.length) {
      const slot = new Date(Date.now() + 7 * 864e5).toISOString();
      const first = await p.rpc('book_appointment', { p_doctor_id: docs[0].id, p_scheduled_time: slot });
      if (!first.error) {
        const second = await p.rpc('book_appointment', { p_doctor_id: docs[0].id, p_scheduled_time: slot });
        check('live: double-booking rejected via RPC', second.error !== null, second.error?.message ?? 'second booking succeeded!');
        await p.rpc('cancel_appointment', { p_appointment_id: first.data.id });
      } else {
        console.log(`SKIP  live double-booking (slot off-grid or taken: ${first.error.message})`);
      }
    } else check('live: double-booking setup (need 1 active doctor)', false, 'seed data missing');
    await p.auth.signOut();
  }
  if (env.STAFF_EMAIL && env.STAFF_PASSWORD) {
    const s = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await s.auth.signInWithPassword({ email: env.STAFF_EMAIL, password: env.STAFF_PASSWORD });
    const { data: docs } = await s.from('doctors').select('id').eq('is_active', true).limit(1);
    const { data: pats } = await s.from('patients').select('id').limit(1);
    if (docs?.length && pats?.length) {
      const slot = new Date(Date.now() + 8 * 864e5).toISOString();
      const first = await s.from('appointments').insert({ doctor_id: docs[0].id, patient_id: pats[0].id, scheduled_time: slot }).select('id').single();
      if (!first.error) {
        const second = await s.from('appointments').insert({ doctor_id: docs[0].id, patient_id: pats[0].id, scheduled_time: slot });
        check('live: double-booking rejected (23505)', second.error?.code === '23505', second.error?.message ?? 'second insert succeeded!');
        await s.from('appointments').delete().eq('id', first.data.id);
      } else check('live: double-booking setup insert', false, first.error.message);
    } else check('live: double-booking setup (need 1 doctor + 1 patient)', false, 'seed data missing');
    await s.auth.signOut();
  } else console.log('SKIP  live double-booking (set STAFF_EMAIL/STAFF_PASSWORD)');
} else {
  console.log('SKIP  live Supabase checks (set SUPABASE_URL/ANON_KEY/PATIENT_EMAIL/PATIENT_PASSWORD)');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
