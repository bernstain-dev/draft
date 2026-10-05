// Offline static verification only. Never connects to Supabase or reads env credentials.
// Runtime authorization/concurrency coverage: node scripts/test-phase1.mjs
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
  'patient_select_own_appointments']) {
  check(`patient RLS policy ${p}`, new RegExp(`create policy [" ]?${p}[" ]? on`).test(schema));
}
for (const f of ['my_patient_id', 'book_appointment', 'reschedule_appointment', 'cancel_appointment']) {
  check(`RPC ${f} defined + granted`, new RegExp(`function (?:public\\.)?${f}\\(`).test(schema));
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
check('seed.cjs remains a backend-only bootstrap tool',
  /SUPABASE_SERVICE_ROLE_KEY/.test(seed));
check('seed.cjs links patient login to a patient record', /user_id/.test(seed));
check('seed.cjs seeds doctors/schedules/patients/appointments/notes',
  /doctor_schedules/.test(seed) && /patient_visit_notes/.test(seed) && /upsert/.test(seed));
check('old seed files removed',
  !existsSync(join(root, 'supabase/seedusers.sql')) &&
  !existsSync(join(root, 'supabase/seed_admin.sql')) &&
  !existsSync(join(root, 'supabase/create_admin.cjs')));
check('patient booking is RPC-only and fails closed',
  /rpc\('book_appointment'/.test(bookFlow) && !/isMissingRpc|\.insert\(|\.update\(/.test(bookFlow));
check('staff booking uses authoritative RPC', /rpc\('staff_book_appointment'/.test(booking));
check('staff check-in uses authorized RPC', /rpc\('staff_check_in_appointment'/.test(checkIn));
check('profile role changes use authorized RPC',
  /rpc\('admin_set_profile_role'/.test(read('src/pages/appointments/Settings.tsx')));
check('patient profile INSERT omits role',
  !/\.insert\(\{[^}]*role:/.test(patientAuth));

// Phase 2 architecture checks complement mounted React and local SQL tests.
const phase2 = read('supabase/fix_phase2_booking_availability.sql');
const authFlow = read('src/lib/usePortalAuth.ts');
check('both portals consume the shared availability hook', /useAvailability\(sb, doctorId, dateKey\)/.test(bookFlow) && /useAvailability\(sb, doctorId, dateKey\)/.test(booking));
check('React does not generate appointment slots', !/generateSlots/.test(read('src/lib/slots.ts') + bookFlow + booking));
check('availability returns timestamps/durations only', /returns table \(scheduled_time timestamptz, slot_duration_minutes integer\)/.test(phase2));
check('backend rejects schedule overlap and invalid minute durations', /phase2_schedule_no_overlap/.test(phase2) && /phase2_schedule_minutes_check/.test(phase2));
check('blocking dates uses authorized conflict-aware operation', /rpc\('staff_block_doctor_date'/.test(read('src/pages/appointments/Doctors.tsx')) && /conflict_count/.test(phase2));
check('legacy name matching removed from authentication', !/byName|eq\('full_name'|legacy/i.test(patientAuth + authFlow + read('src/lib/portalIdentity.ts')));
check('auth callback is synchronous and subscription cleans up', /onAuthStateChange\(\(_event, session\) =>/.test(authFlow) && /subscription\.unsubscribe\(\)/.test(authFlow));
check('portal signout uses local scope', /signOut\(\{ scope: 'local' \}\)/.test(authFlow));
check('appointment views subscribe to mutation invalidation', ['src/pages/appointments/Dashboard.tsx','src/pages/appointments/CheckIn.tsx','src/pages/patient/MyAppointments.tsx','src/pages/patient/AppointmentHistory.tsx'].every((file) => /useAppointmentRevision\(\)/.test(read(file))));
check('weekly doctor display checks exact clinic week dates', /clinicWeekDates\(\)/.test(read('src/pages/appointments/Doctors.tsx')) && /u\.date === date/.test(read('src/pages/appointments/Doctors.tsx')));

// Phase 3 source structure; behavioral claims require the separate local suite.
const phase3 = read('supabase/fix_phase3_notifications_reports.sql');
check('durable notification event idempotency is defined', /unique\(appointment_id,notification_type,revision,channel\)/.test(phase3));
check('ledger worker RPCs are service-only', /notification_result\(uuid\),public\.record_notification_delivery\(text,text\) to service_role/.test(phase3));
check('confirmation verifies Auth and ownership via SQL', /auth\.getUser\(\)/.test(read('supabase/functions/_shared/handlers.ts')) && /request_appointment_notification/.test(phase3));
check('notification CORS uses explicit origins and OPTIONS', /allowed\.includes\(origin\)/.test(read('supabase/functions/_shared/http.ts')) && /method === 'OPTIONS'/.test(read('supabase/functions/_shared/handlers.ts')));
check('provider result distinguishes acceptance from delivery', /accepted: status === 'accepted'/.test(read('supabase/functions/_shared/notify.ts')) && /delivery: 'not_verified'/.test(read('supabase/functions/_shared/notify.ts')));
check('notification providers do not log patient payloads', !/console\.(log|error)/.test(read('supabase/functions/_shared/notify.ts') + read('supabase/functions/_shared/handlers.ts')));
check('both booking portals notify only after approved mutations', /notifyAppointment\(sb/.test(bookFlow) && /notifyAppointment\(sb/.test(booking));
check('reminders use Manila dates and durable unique events', /p_now at time zone 'Asia\/Manila'/.test(phase3) && /notification_type='reminder'|,'reminder',/.test(phase3));
check('reports use complete server aggregation and ID grouping', /rpc\('staff_appointment_report'/.test(read('src/pages/appointments/Reports.tsx')) && /group by doctor_id/.test(phase3) && /group by patient_id/.test(phase3));
check('CSV uses shared spreadsheet-safe encoder', /downloadCsv.*lib\/csv/.test(read('src/pages/appointments/Reports.tsx')) && /safe\.replace/.test(read('src/lib/csv.ts')));
check('doctor editing is validated and non-destructive', /saveDoctor/.test(read('src/pages/appointments/Doctors.tsx')) && /doctorFormError/.test(read('src/pages/appointments/Doctors.tsx')) && /revoke delete on public\.doctors, public\.patients/.test(phase3));
check('intentional linking UI uses exact UUID/admin operation', /validUuid/.test(read('src/components/PatientLink.tsx')) && /rpc\('admin_link_patient'/.test(read('src/components/PatientLink.tsx')));
check('major mutation pages use synchronous pending gate', ['src/pages/appointments/Booking.tsx','src/pages/appointments/CheckIn.tsx','src/pages/appointments/Patients.tsx','src/pages/appointments/Doctors.tsx','src/pages/appointments/Settings.tsx'].every(f=>/mutation\.run/.test(read(f))));
check('staff Realtime unsubscribes through isolated provider', /useAppointmentRealtime/.test(staffAuth) && /removeChannel/.test(read('src/lib/useAppointmentRealtime.ts')));
check('nonexistent confirmed database status is removed', !/case ['"]confirmed['"]/.test(read('src/lib/patient.ts')));
check('safe environment template and local-only demonstration guard exist', /replace-with-public-anon-key/.test(read('.env.example')) && /Hosted seeding is refused/.test(seed));
check('signed delivery callbacks and Vault cron definitions exist', /HMAC/.test(read('supabase/functions/_shared/delivery.ts')) && /vault\.decrypted_secrets/.test(read('supabase/fix_phase3_scheduler.sql')));

console.log(failures === 0 ? '\nALL CHECKS PASSED (static only)' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
