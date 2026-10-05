// Mounted real hooks/components with controlled synthetic clients; no network.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { renderedText } from './rendered-text.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Compile TS/TSX in memory. Replace only the client factory and public Vite
// feature flags in this test process; never read .env or contact Supabase.
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) {
      if (specifier.startsWith('.') && context.parentURL) {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        for (const extension of ['.ts','.tsx']) if (existsSync(base + extension)) return { url: pathToFileURL(base + extension).href, shortCircuit: true };
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (!/\.tsx?$/.test(url)) return next(url, context);
    if (url.endsWith('/src/lib/supabaseClient.ts')) return { format: 'module', shortCircuit: true,
      source: 'export function createAppClient(key) { return globalThis.__phase2Clients[key]; }' };
    const source = readFileSync(fileURLToPath(url), 'utf8').replaceAll('import.meta.env', '({ VITE_NOTIFY_ENABLED: "false" })');
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    }).outputText };
  },
});
const { usePortalAuth } = await import('../src/lib/usePortalAuth.ts');
const { useAvailability } = await import('../src/lib/useAvailability.ts');
const { useClinicQuery, useAppointmentRevision } = await import('../src/lib/useClinicQuery.ts');
const { appointmentMutationSucceeded, subscribeAppointmentChanges } = await import('../src/lib/appointmentChanges.ts');
const { scheduleInputError } = await import('../src/lib/scheduleValidation.ts');
const deferred = () => { let resolve; const promise = new Promise((done) => resolve = done); return { promise, resolve }; };
const sleep = (ms = 8) => new Promise((done) => setTimeout(done, ms));
async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Expected synthetic request did not start within 3 seconds');
    await sleep(5);
  }
}
let passed = 0;
async function test(name, body) { await body(); passed++; console.log(`PASS ${name}`); }
const user = (id) => ({ id, email: 'synthetic@example.invalid', user_metadata: { full_name: 'Synthetic Patient' } });
const packet = (id) => ({ profile: { id, full_name: 'Synthetic Patient', role: 'patient' }, patient: { id: `patient-${id}`, user_id: id, full_name: 'Synthetic Patient' } });
function authClient() {
  const initial = deferred(); const calls = []; let listener; let unsubscribed = 0;
  return { calls, initial, get unsubscribed() { return unsubscribed; }, emit(value) { listener('SIGNED_IN', value ? { user: user(value) } : null); },
    auth: { getSession: () => initial.promise, onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() { unsubscribed++; } } } }; },
      async signInWithPassword() { return { data: { user: user('failed') }, error: null }; },
      async signUp() { return { data: { user: user('failed'), session: { user: user('failed') } }, error: null }; },
      async signOut(options) { assert.equal(options.scope, 'local'); listener('SIGNED_OUT', null); return { error: null }; } },
    rpc(name, args) { assert.equal(name, 'ensure_patient_identity'); const request = deferred(); calls.push({ request, args }); return { abortSignal: () => request.promise }; },
  };
}
await test('H: real auth hook clears prior patient immediately and stale identity/initial-session results cannot win', async () => {
  const client = authClient(); let state; let tree;
  function Probe() { state = usePortalAuth(client, 'patient'); return null; }
  await act(async () => { tree = Renderer.create(React.createElement(Probe)); await sleep(); client.emit('A'); await waitFor(() => client.calls.length >= 1); });
  await act(async () => client.calls[0].request.resolve({ data: packet('A'), error: null }));
  assert.equal(state.patient.user_id, 'A');
  await act(async () => { client.emit('B'); });
  assert.equal(state.patient, null); assert.equal(state.profile, null);
  await act(async () => { await waitFor(() => client.calls.length >= 2); client.emit('C'); await waitFor(() => client.calls.length >= 3); });
  await act(async () => client.calls[2].request.resolve({ data: packet('C'), error: null }));
  await act(async () => { client.calls[1].request.resolve({ data: null, error: { message: 'Late obsolete identity failure' } }); client.initial.resolve({ data: { session: { user: user('A') } }, error: null }); await sleep(); });
  assert.equal(state.user.id, 'C'); assert.equal(state.patient.user_id, 'C'); assert.equal(state.loading, false);
  await act(async () => { client.emit(null); });
  assert.equal(state.user, null); assert.equal(state.patient, null);
  await act(async () => tree.unmount()); assert.equal(client.unsubscribed, 1);
});
await test('I: failed or mismatched linkage returns an explicit error, clears identity and ends loading', async () => {
  const client = authClient(); let state, tree;
  function Probe() { state = usePortalAuth(client, 'patient'); return null; }
  await act(async () => { tree = Renderer.create(React.createElement(Probe)); await sleep(); client.emit('failed'); await waitFor(() => client.calls.length >= 1); });
  await act(async () => client.calls[0].request.resolve({ data: null, error: { message: 'Synthetic linking failure' } }));
  assert.equal(state.loading, false); assert.equal(state.patient, null); assert.match(state.error, /linking failure/);
  let result;
  await act(async () => { const pending = state.signIn('synthetic@example.invalid','synthetic'); await waitFor(() => client.calls.length >= 2); client.calls[1].request.resolve({ data: packet('wrong-user'), error: null }); result = await pending; });
  assert.match(result, /could not be verified/); assert.equal(state.profile, null); assert.equal(state.patient, null);
  await act(async () => { const pending = state.signUp('Synthetic Signup','synthetic@example.invalid','synthetic'); await waitFor(() => client.calls.length >= 3);
    client.calls[2].request.resolve({ data: null, error: { message: 'Synthetic signup linking failure' } }); result = await pending; });
  assert.match(result, /signup linking failure/); assert.equal(state.loading, false); assert.equal(state.patient, null);
  await act(async () => tree.unmount());
});
await test('wrong portal role fails closed, and signout uses local scope', async () => {
  const client = authClient(); let state, tree;
  function Probe() { state = usePortalAuth(client, 'patient'); return null; }
  await act(async () => { tree = Renderer.create(React.createElement(Probe)); await sleep(); client.emit('A'); await waitFor(() => client.calls.length >= 1); });
  const wrong = packet('A'); wrong.profile.role = 'admin';
  await act(async () => client.calls[0].request.resolve({ data: wrong, error: null }));
  assert.equal(state.profile, null); assert.equal(state.patient, null); assert.ok(state.error);
  await act(async () => state.signOut()); assert.equal(state.user, null);
  await act(async () => tree.unmount());
});
await test('K: real availability hook rejects late responses after rapid doctor/date changes and unmount', async () => {
  const calls = []; const client = { rpc(name, args) { const request = deferred(); calls.push({ request, args }); return { abortSignal(signal) { calls.at(-1).signal = signal; return request.promise; } }; } };
  let state, tree;
  function Probe({ doctor, date }) { state = useAvailability(client, doctor, date); return null; }
  await act(async () => { tree = Renderer.create(React.createElement(Probe, { doctor: 'doctor-A', date: '2026-10-10' })); await sleep(); });
  await act(async () => { tree.update(React.createElement(Probe, { doctor: 'doctor-B', date: '2026-10-11' })); await sleep(); });
  assert.equal(calls[0].signal.aborted, true); assert.deepEqual(state.data, []);
  const newest = [{ scheduled_time: '2026-10-11T01:00:00Z', slot_duration_minutes: 30 }];
  await act(async () => calls[1].request.resolve({ data: newest, error: null }));
  await act(async () => calls[0].request.resolve({ data: [{ scheduled_time: '2026-10-10T02:00:00Z', slot_duration_minutes: 30 }], error: null }));
  assert.equal(state.data[0].iso, newest[0].scheduled_time);
  await act(async () => tree.unmount()); assert.equal(calls[1].signal.aborted, true);
});
await test('all subscribed appointment views reload only after successful persisted operations and unsubscribe', async () => {
  const counts = {}; let tree;
  function View({ name }) { const revision = useAppointmentRevision(); useClinicQuery(`${name}/${revision}`, async () => { counts[name] = (counts[name] ?? 0) + 1; return []; }, []); return null; }
  await act(async () => { tree = Renderer.create(React.createElement(React.Fragment, null,
    ...['staff-upcoming','staff-day','patient-list','check-in'].map((name) => React.createElement(View, { name, key: name })))); await sleep(); });
  await act(async () => { assert.equal(appointmentMutationSucceeded({ data: null, error: 'failed' }), false); await sleep(); });
  assert.deepEqual(Object.values(counts), [1,1,1,1]);
  for (let i = 0; i < 3; i++) await act(async () => { appointmentMutationSucceeded({ data: { success: true }, error: null }); await sleep(); });
  assert.deepEqual(Object.values(counts), [4,4,4,4]);
  await act(async () => tree.unmount());
  const before = JSON.stringify(counts); appointmentMutationSucceeded({ data: { success: true }, error: null }); await sleep(); assert.equal(JSON.stringify(counts), before);
});
await test('J: clinic timestamps, day/month bounds and exact week dates are identical in three runtime timezones', async () => {
  const url = pathToFileURL(join(root, 'src/lib/clinicTime.ts')).href;
  const code = `import * as t from ${JSON.stringify(url)}; const key='2026-10-10'; const iso=t.clinicInstant(key,'09:00'); console.log(JSON.stringify({ iso, date:t.clinicDateKey(iso), time:t.clinicTimeKey(iso), display:t.formatClinicDateTime(iso), range:t.clinicDayRange(key), month:t.clinicMonthRange(key), week:t.clinicWeekDates(key), shifted:t.clinicDateKey('2026-10-09T16:30:00Z') }));`;
  const outputs = ['Asia/Manila','UTC','America/New_York'].map((TZ) => {
    const result = spawnSync(process.execPath, ['--input-type=module','-e',code], { encoding: 'utf8', env: { ...process.env, TZ }, windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  });
  assert.equal(outputs[0], outputs[1]); assert.equal(outputs[0], outputs[2]);
  const result = JSON.parse(outputs[0]); assert.equal(result.iso, '2026-10-10T01:00:00.000Z'); assert.equal(result.shifted, '2026-10-10'); assert.equal(result.time, '09:00');
});
await test('schedule form rejects non-minute, zero, negative and oversized durations', async () => {
  const valid = { day_of_week: 1, start_time: '09:00', end_time: '10:00', slot_duration_minutes: 30 };
  assert.equal(scheduleInputError(valid), null);
  for (const duration of [0,-1,0.5,61,1441]) assert.ok(scheduleInputError({ ...valid, slot_duration_minutes: duration }));
  assert.ok(scheduleInputError({ ...valid, start_time: '09:00:01' }));
});

// Fake database for the ACTUAL staff Booking component; SQL behavior is tested
// separately against PostgreSQL. Here we test handlers/read refresh wiring.
const doctor = { id: '20000000-0000-0000-0000-000000000001', full_name: 'Synthetic Doctor', is_active: true };
const patient = { id: '10000000-0000-0000-0000-000000000001', full_name: 'Synthetic Patient' };
const admin = user('00000000-0000-0000-0000-000000000001');
const { clinicDateKey, addClinicDays, clinicInstant, clinicWeekDates } = await import('../src/lib/clinicTime.ts');
const date = addClinicDays(clinicDateKey(), 10); const firstSlot = clinicInstant(date, '09:00'), nextSlot = clinicInstant(date, '09:30');
let appointments = []; const queryCounts = {}; let serial = 1;
let calendarBlocks = [{ id: 'synthetic-block', doctor_id: doctor.id, date: addClinicDays(clinicWeekDates()[1],28), reason: 'Synthetic leave' }];
const appClient = {
  // Phase 3 staff provider now subscribes; keep this regression fixture offline.
  channel() { const channel = { on() { return channel; }, subscribe() { return channel; } }; return channel; },
  async removeChannel() {},
  auth: { getSession: async () => ({ data: { session: { user: admin } }, error: null }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
  from(table) {
    const filters = []; const query = { select() { return query; }, order() { return query; }, limit() { return query; }, ilike() { return query; },
      eq(key, value) { filters.push((r) => r[key] === value); return query; }, in(key, values) { filters.push((r) => values.includes(r[key])); return query; },
      abortSignal() { return query; }, maybeSingle() { return query; },
      then(yes, no) {
        queryCounts[table] = (queryCounts[table] ?? 0) + 1;
        let data = table === 'profiles' ? { id: admin.id, full_name: 'Synthetic Admin', role: 'admin' }
          : table === 'doctors' ? [doctor] : table === 'patients' ? [patient]
          : table === 'doctor_schedules' ? [{ id:'synthetic-schedule', doctor_id:doctor.id, day_of_week:1, start_time:'09:00', end_time:'17:00', slot_duration_minutes:30 }]
          : table === 'doctor_unavailable_dates' ? calendarBlocks : appointments.map((a) => ({ ...a, patient, doctor }));
        if (Array.isArray(data)) data = data.filter((r) => filters.every((filter) => filter(r)));
        return Promise.resolve({ data, error: null }).then(yes, no);
      } };
    return query;
  },
  rpc(name, args) {
    let data;
    if (name === 'get_available_appointment_slots') data = [firstSlot,nextSlot].filter((iso) => !appointments.some((a) => a.status !== 'cancelled' && a.scheduled_time === iso)).map((scheduled_time) => ({ scheduled_time, slot_duration_minutes: 30 }));
    if (name === 'staff_book_appointment') {
      const id = `30000000-0000-0000-0000-${String(serial++).padStart(12,'0')}`;
      appointments.push({ id, doctor_id: doctor.id, patient_id: patient.id, scheduled_time: args.p_scheduled_time, status: 'scheduled', source: 'pre_booked' }); data = { success: true, id };
    }
    if (name === 'staff_reschedule_appointment') { appointments.find((a) => a.id === args.p_appointment_id).scheduled_time = args.p_scheduled_time; data = { success: true, id: args.p_appointment_id }; }
    if (name === 'staff_cancel_appointment') { appointments.find((a) => a.id === args.p_appointment_id).status = 'cancelled'; data = { success: true, id: args.p_appointment_id }; }
    const promise = Promise.resolve({ data, error: null }); promise.abortSignal = () => promise; return promise;
  },
};
globalThis.__phase2Clients = { 'medical-appointments-staff': appClient }; globalThis.confirm = () => true;
const { default: Booking } = await import('../src/pages/appointments/Booking.tsx');
await test('L: actual staff Booking handlers refresh the displayed upcoming list after book/move/cancel', async () => {
  let tree;
  await act(async () => { tree = Renderer.create(React.createElement(Booking)); await sleep(15); });
  const change = async (node, value) => act(async () => { node.props.onChange({ target: { value } }); await sleep(); });
  await change(tree.root.findByProps({ type: 'date' }), date);
  await act(async () => { const search = tree.root.findByProps({ title: 'Find patient' }); search.props.onClick(); await sleep(); });
  const selectedPatient = tree.root.findAllByType('select')[1]; await change(selectedPatient, patient.id);
  const button = (text) => tree.root.findAllByType('button').find((b) => renderedText(b) === text);
  await act(async () => { button('09:00').props.onClick(); });
  const readsBefore = queryCounts.appointments;
  await act(async () => { await tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); await sleep(15); });
  assert.ok(queryCounts.appointments > readsBefore);
  assert.ok(button('Cancel')); assert.match(JSON.stringify(tree.toJSON()), /Synthetic Patient/);
  const id = appointments[0].id; await change(tree.root.findAllByType('select')[4], id);
  await act(async () => button('09:30').props.onClick());
  await act(async () => { await button('Move').props.onClick(); await sleep(15); });
  assert.equal(appointments[0].scheduled_time, nextSlot); assert.match(JSON.stringify(tree.toJSON()), /09:30|9:30/);
  await act(async () => { await button('Cancel').props.onClick(); await sleep(15); });
  assert.equal(button('Cancel'), undefined); assert.match(JSON.stringify(tree.toJSON()), /No upcoming appointments/);
  await act(async () => tree.unmount());
});
await test('weekly doctor view uses exact displayed dates; a Monday four weeks later is not Leave this week', async () => {
  const { default: Doctors } = await import('../src/pages/appointments/Doctors.tsx');
  const { StaffAuthProvider } = await import('../src/pages/appointments/auth/staffAuth.tsx');
  let tree;
  await act(async () => { tree = Renderer.create(React.createElement(StaffAuthProvider,null,React.createElement(Doctors))); await sleep(15); });
  await act(async () => { tree.root.findAllByType('button')[0].props.onClick(); await sleep(15); });
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /"Leave"/);
  calendarBlocks = [{ ...calendarBlocks[0], date: clinicWeekDates()[1] }];
  await act(async () => { appointmentMutationSucceeded({ data:{success:true}, error:null }); await sleep(15); });
  assert.match(JSON.stringify(tree.toJSON()), /"Leave"/);
  await act(async () => tree.unmount());
});
console.log(`\n${passed} Phase 2 mounted UI/timezone checks passed. No production client used.`);
