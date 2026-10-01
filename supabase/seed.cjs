const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const ACCOUNTS = [
  { email: 'vacunawa@gmail.com', password: 'admin123', full_name: 'RHU Admin', role: 'admin', login: '/appointments/login' },
  { email: 'patient@gmail.com', password: 'patient123', full_name: 'Maria Santos', role: 'patient', login: '/patient/login' },
];

// Fixed UUIDs keep re-runs stable (upsert on id).
const D = {
  reyes: 'a0000000-0000-0000-0000-000000000001',
  santos: 'a0000000-0000-0000-0000-000000000002',
  cruz: 'a0000000-0000-0000-0000-000000000003',
  bautista: 'a0000000-0000-0000-0000-000000000004',
  ramirez: 'a0000000-0000-0000-0000-000000000005',
  lim: 'a0000000-0000-0000-0000-000000000006',
  mendoza: 'a0000000-0000-0000-0000-000000000007',
  torres: 'a0000000-0000-0000-0000-000000000008',
  villanueva: 'a0000000-0000-0000-0000-000000000009',
  garcia: 'a0000000-0000-0000-0000-000000000010',
};
const P = {
  juan: 'b0000000-0000-0000-0000-000000000001',
  maria: 'b0000000-0000-0000-0000-000000000002',
  pedro: 'b0000000-0000-0000-0000-000000000003',
  ana: 'b0000000-0000-0000-0000-000000000004',
  carmela: 'b0000000-0000-0000-0000-000000000005',
  jose: 'b0000000-0000-0000-0000-000000000006',
  grace: 'b0000000-0000-0000-0000-000000000007',
  ramon: 'b0000000-0000-0000-0000-000000000008',
  liza: 'b0000000-0000-0000-0000-000000000009',
  mark: 'b0000000-0000-0000-0000-000000000010',
};

const pad = (n) => String(n).padStart(2, '0');
// 'YYYY-MM-DD' for a day offset from today (local calendar day).
function dateKey(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// 'YYYY-MM-DDTHH:MM:SS' (no offset — Postgres interprets it in the DB
// timezone, mirroring the old SQL seed's `current_date + time 'HH:MM'`).
function ts(offsetDays, hhmm) {
  return `${dateKey(offsetDays)}T${hhmm}:00`;
}

(async () => {
  const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const fail = (msg) => {
    console.error(msg);
    process.exit(1);
  };
  const ids = {};

  // ---- 1) accounts + profiles ----
  for (const a of ACCOUNTS) {
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers();
    if (listErr) fail(`listUsers failed: ${listErr.message}`);
    let user = list.users.find((u) => u.email === a.email);
    if (!user) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: a.email, password: a.password, email_confirm: true,
        user_metadata: { full_name: a.full_name },
      });
      if (error) fail(`createUser ${a.email} failed: ${error.message}`);
      user = data.user;
      console.log(`auth created: ${a.email} (${user.id})`);
    } else {
      const { error } = await supabase.auth.admin.updateUserById(user.id, { password: a.password, email_confirm: true });
      if (error) fail(`password reset ${a.email} failed: ${error.message}`);
      console.log(`auth exists: ${a.email} (${user.id}), password ensured`);
    }
    ids[a.role] = user.id;
    const { error: pErr } = await supabase.from('profiles').upsert(
      { id: user.id, full_name: a.full_name, role: a.role },
      { onConflict: 'id' }
    );
    if (pErr) fail(`profiles upsert ${a.email} failed: ${pErr.message}`);
    console.log(`profile linked: ${a.email} -> ${a.role}`);
  }

  const upsert = async (table, rows, label) => {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
    if (error) fail(`${label} failed: ${error.message}`);
    console.log(`${label}: ok (${rows.length} rows)`);
  };

  // ---- 2a) doctors (directory only — no doctor login; admin manages) ----
  await upsert('doctors', [
    { id: D.reyes, profile_id: null, full_name: 'Dr. Ana Reyes', specialty: 'General medicine', is_active: true },
    { id: D.santos, profile_id: null, full_name: 'Dr. Mark Santos', specialty: 'Pediatrics', is_active: true },
    { id: D.cruz, profile_id: null, full_name: 'Dr. Liza Cruz', specialty: 'OB-Gyne', is_active: true },
    { id: D.bautista, profile_id: null, full_name: 'Dr. Paolo Bautista', specialty: 'Dentistry', is_active: true },
    { id: D.ramirez, profile_id: null, full_name: 'Dr. Jose Ramirez', specialty: 'Cardiology', is_active: true },
    { id: D.lim, profile_id: null, full_name: 'Dr. Kevin Lim', specialty: 'Dermatology', is_active: true },
    { id: D.mendoza, profile_id: null, full_name: 'Dra. Sofia Mendoza', specialty: 'Ophthalmology', is_active: true },
    { id: D.torres, profile_id: null, full_name: 'Dr. Daniel Torres', specialty: 'ENT', is_active: true },
    { id: D.villanueva, profile_id: null, full_name: 'Dra. Patricia Villanueva', specialty: 'Orthopedics', is_active: true },
    { id: D.garcia, profile_id: null, full_name: 'Dr. Robert Garcia', specialty: 'Internal Medicine', is_active: true },
  ], 'doctors');

  // ---- 2b) schedules (Mon–Sun 08:00–17:00 x30m for EVERY doctor,
  //      so every future date always has bookable slots) ----
  let n = 101;
  const sched = (doctor_id, dow, start, end) => ({ id: `c0000000-0000-0000-0000-000000000${n++}`, doctor_id, day_of_week: dow, start_time: start, end_time: end, slot_duration_minutes: 30 });
  const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
  const schedRows = [];
  for (const docId of Object.values(D)) {
    for (const dow of WEEK) schedRows.push(sched(docId, dow, '08:00', '17:00'));
  }
  await upsert('doctor_schedules', schedRows, 'doctor_schedules');

  // ---- 2c) no blocked dates (every slot stays available) ----

  // ---- 2d) patients (Maria Santos linked to the patient demo login) ----
  const pat = (id, full_name, date_of_birth, contact_number, address, user_id = null) => (
    { id, full_name, date_of_birth, contact_number, address, user_id }
  );
  await upsert('patients', [
    pat(P.juan, 'Juan Dela Cruz', '1985-03-12', '09171234501', 'Poblacion, Bauang, La Union'),
    pat(P.maria, 'Maria Santos', '1990-07-22', '09171234502', 'Paringao, Bauang, La Union', ids.patient),
    pat(P.pedro, 'Pedro Reyes', '1955-01-05', '09171234503', 'Central West, Bauang, La Union'),
    pat(P.ana, 'Ana Lopez', '2022-05-10', '09171234504', 'Nagrebcan, Bauang, La Union'),
    pat(P.carmela, 'Carmela Ramos', '1998-11-30', '09171234505', 'Pilar, Bauang, La Union'),
    pat(P.jose, 'Jose Manalo', '1948-09-18', '09171234506', 'Payocpoc, Bauang, La Union'),
    pat(P.grace, 'Grace Fernandez', '1975-02-14', '09171234507', 'Baccuit, Bauang, La Union'),
    pat(P.ramon, 'Ramon Torres', '2001-06-25', '09171234508', 'Acao, Bauang, La Union'),
    pat(P.liza, 'Liza Gonzales', '1988-12-01', '09171234509', 'Cabalayangan, Bauang, La Union'),
    pat(P.mark, 'Mark Villanueva', '1965-04-09', '09171234510', 'Disso-or, Bauang, La Union'),
  ], 'patients');

  // ---- 2e) appointments: yesterday / today / tomorrow / next week ----
  const appt = (id, patient_id, doctor_id, when, source, status, extra = {}) => (
    { id, patient_id, doctor_id, scheduled_time: when, source, status, ...extra }
  );
  await upsert('appointments', [
    // yesterday
    appt('e0000000-0000-0000-0000-000000000001', P.juan, D.reyes, ts(-1, '09:00'), 'pre_booked', 'completed',
      { room: '1', checked_in_at: ts(-1, '08:55') }),
    appt('e0000000-0000-0000-0000-000000000002', P.jose, D.reyes, ts(-1, '09:30'), 'pre_booked', 'no_show'),
    // today
    appt('e0000000-0000-0000-0000-000000000003', P.maria, D.reyes, ts(0, '08:30'), 'walk_in', 'completed',
      { room: '1', checked_in_at: ts(0, '08:28') }),
    appt('e0000000-0000-0000-0000-000000000004', P.pedro, D.reyes, ts(0, '09:00'), 'pre_booked', 'in_progress',
      { room: '1', checked_in_at: ts(0, '08:50') }),
    appt('e0000000-0000-0000-0000-000000000005', P.grace, D.santos, ts(0, '09:00'), 'pre_booked', 'waiting',
      { room: '2', checked_in_at: ts(0, '08:45') }),
    appt('e0000000-0000-0000-0000-000000000006', P.ana, D.santos, ts(0, '09:30'), 'walk_in', 'checked_in',
      { checked_in_at: ts(0, '09:20') }),
    appt('e0000000-0000-0000-0000-000000000007', P.liza, D.cruz, ts(0, '10:00'), 'pre_booked', 'scheduled'),
    appt('e0000000-0000-0000-0000-000000000008', P.mark, D.reyes, ts(0, '10:30'), 'walk_in', 'scheduled'),
    appt('e0000000-0000-0000-0000-000000000009', P.carmela, D.cruz, ts(0, '11:00'), 'pre_booked', 'cancelled'),
    appt('e0000000-0000-0000-0000-000000000010', P.jose, D.bautista, ts(0, '13:00'), 'pre_booked', 'scheduled'),
    // tomorrow — follow-up linked to today's completed visit (…003)
    appt('e0000000-0000-0000-0000-000000000011', P.maria, D.reyes, ts(1, '09:00'), 'pre_booked', 'scheduled',
      { is_recurring: true, recurrence_parent_id: 'e0000000-0000-0000-0000-000000000003' }),
    // next week
    appt('e0000000-0000-0000-0000-000000000012', P.ramon, D.santos, ts(7, '10:00'), 'pre_booked', 'scheduled'),
  ], 'appointments');

  // ---- 2f) visit note for today's completed appointment (…003) ----
  await upsert('patient_visit_notes', [
    {
      id: 'f0000000-0000-0000-0000-000000000001',
      patient_id: P.maria,
      appointment_id: 'e0000000-0000-0000-0000-000000000003',
      note: 'Mild fever and cough. Prescribed paracetamol, advised rest and follow-up in one week.',
    },
  ], 'patient_visit_notes');

  // ---- 3) login smoke test (same path the apps use) ----
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (anonKey) {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    for (const a of ACCOUNTS) {
      const { error } = await anon.auth.signInWithPassword({ email: a.email, password: a.password });
      console.log(error ? `login FAIL ${a.email}: ${error.message}` : `login ok ${a.email} (${a.role}) -> ${a.login}`);
      await anon.auth.signOut();
    }
  } else {
    console.log('skipped login check (no SUPABASE_ANON_KEY in env)');
  }
  console.log('SEED DONE');
})();
