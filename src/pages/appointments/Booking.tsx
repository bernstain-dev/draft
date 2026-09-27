import { useEffect, useMemo, useState } from 'react';
import { getStaffClient, useStaffAuth } from './auth/staffAuth';
import type { Appointment, Doctor, DoctorSchedule, DoctorUnavailable, Patient } from '../../lib/types';
import { generateSlots, toLocalDateKey } from '../../lib/slots';

export default function Booking() {
  const sb = getStaffClient();
  const { user } = useStaffAuth();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState('');
  const [dateKey, setDateKey] = useState(toLocalDateKey(new Date()));
  const [schedules, setSchedules] = useState<DoctorSchedule[]>([]);
  const [unavail, setUnavail] = useState<DoctorUnavailable[]>([]);
  const [booked, setBooked] = useState<Appointment[]>([]);
  const [slotIso, setSlotIso] = useState('');
  const [patientQuery, setPatientQuery] = useState('');
  const [patientOpts, setPatientOpts] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState('');
  const [source, setSource] = useState<'pre_booked' | 'walk_in'>('pre_booked');
  const [room, setRoom] = useState('');
  const [followUpOf, setFollowUpOf] = useState('');
  const [pastAppts, setPastAppts] = useState<Appointment[]>([]);
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  // reschedule
  const [reschedId, setReschedId] = useState('');
  const [upcoming, setUpcoming] = useState<(Appointment & { patient?: Patient; doctor?: Doctor })[]>([]);

  useEffect(() => {
    sb.from('doctors').select('*').eq('is_active', true).order('full_name').then(({ data }) => {
      const list = (data as Doctor[]) ?? [];
      setDoctors(list);
      if (list.length > 0 && !doctorId) setDoctorId(list[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDay() {
    if (!doctorId || !dateKey) return;
    const dayStart = new Date(`${dateKey}T00:00:00`);
    const dayEnd = new Date(`${dateKey}T23:59:59`);
    const [{ data: s }, { data: u }, { data: b }] = await Promise.all([
      sb.from('doctor_schedules').select('*').eq('doctor_id', doctorId),
      sb.from('doctor_unavailable_dates').select('*').eq('doctor_id', doctorId).eq('date', dateKey),
      sb.from('appointments').select('*').eq('doctor_id', doctorId).gte('scheduled_time', dayStart.toISOString()).lte('scheduled_time', dayEnd.toISOString()),
    ]);
    setSchedules((s as DoctorSchedule[]) ?? []);
    setUnavail((u as DoctorUnavailable[]) ?? []);
    setBooked((b as Appointment[]) ?? []);
    setSlotIso('');
  }

  useEffect(() => {
    void loadDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, dateKey]);

  useEffect(() => {
    sb.from('appointments')
      .select('*, patient:patients(*), doctor:doctors(*)')
      .in('status', ['scheduled', 'checked_in', 'waiting', 'in_progress'])
      .order('scheduled_time')
      .limit(50)
      .then(({ data }) => setUpcoming((data as never as typeof upcoming) ?? []));
  }, [sb]);

  // Past appointments of the selected patient feed the follow-up dropdown,
  // so only real UUIDs (or "") can ever reach recurrence_parent_id.
  useEffect(() => {
    setFollowUpOf('');
    if (!patientId) {
      setPastAppts([]);
      return;
    }
    sb.from('appointments')
      .select('*')
      .eq('patient_id', patientId)
      .order('scheduled_time', { ascending: false })
      .limit(20)
      .then(({ data }) => setPastAppts((data as Appointment[]) ?? []));
  }, [patientId, sb]);

  const slots = useMemo(() => {
    const dow = new Date(`${dateKey}T12:00:00`).getDay();
    return generateSlots(dateKey, schedules, unavail, booked, dow);
  }, [dateKey, schedules, unavail, booked]);

  async function searchPatients() {
    const { data } = await sb.from('patients').select('*').ilike('full_name', `%${patientQuery.trim()}%`).limit(10);
    setPatientOpts((data as Patient[]) ?? []);
  }

  // Belt-and-braces: recurrence_parent_id is uuid — never submit raw text.
  const isUuid = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());

  // Notification invoke is gated: only call the Edge Function when the
  // deployment exists (VITE_NOTIFY_ENABLED=true). Otherwise the browser
  // throws noisy CORS/preflight errors for a function that isn't there.
  // Booking already succeeded at this point — notifications never block it.
  const notifyEnabled = (import.meta.env.VITE_NOTIFY_ENABLED as string | undefined) === 'true';

  async function book(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!doctorId || !slotIso || !patientId) {
      setMsg('Pick doctor, slot, and patient.');
      return;
    }
    const followUpId = isUuid(followUpOf) ? followUpOf.trim() : null;
    const { data, error } = await sb
      .from('appointments')
      .insert({
        doctor_id: doctorId,
        patient_id: patientId,
        scheduled_time: slotIso,
        source,
        room: room || null,
        is_recurring: Boolean(followUpId),
        recurrence_parent_id: followUpId,
        created_by: user?.id ?? null,
      })
      .select('id')
      .single();
    if (error) {
      // 23505 = double-booking rejected at DB level
      setMsg(error.code === '23505' ? 'Slot just taken (double-booking blocked). Pick another slot.' : error.message);
    } else {
      const newId = (data as { id: string }).id;
      let doneMsg = `Booked ✓ (${newId.slice(0, 8)}…).`;
      setSlotIso('');
      void loadDay();
      // Free-text notes/reason go to patient_visit_notes (text column) —
      // never to a uuid column (see Bug 2 fix above).
      if (notes.trim()) {
        const { error: noteErr } = await sb.from('patient_visit_notes').insert({
          patient_id: patientId,
          appointment_id: newId,
          note: notes.trim(),
        });
        if (noteErr) doneMsg = `Booked ✓ but note failed to save (${noteErr.message}).`;
        else setNotes('');
      }
      // Best-effort confirmation via Edge Function (stubbed until a
      // provider is configured). Booking already succeeded — never throws.
      // Skipped entirely unless VITE_NOTIFY_ENABLED=true (function deployed),
      // so undeployed functions cause zero console noise (no CORS preflight).
      if (!notifyEnabled) {
        setMsg(doneMsg);
      } else try {
        const { data: fnData, error: fnError } = await sb.functions.invoke('send-confirmation', {
          body: { appointment_id: newId },
        });
        if (fnError) {
          setMsg(`${doneMsg} Confirmation not sent (${fnError.message}).`);
        } else {
          const stubbed = (fnData as { stubbed?: boolean } | null)?.stubbed;
          setMsg(
            stubbed
              ? `${doneMsg} Confirmation logged (no provider configured yet).`
              : `${doneMsg} Confirmation sent ✓`
          );
        }
      } catch (e) {
        setMsg(`${doneMsg} Confirmation skipped (function not deployed yet).`);
      }
    }
  }

  async function reschedule() {
    if (!reschedId || !slotIso) {
      setMsg('Select an appointment and a new slot to reschedule.');
      return;
    }
    const { error } = await sb.from('appointments').update({ scheduled_time: slotIso, doctor_id: doctorId }).eq('id', reschedId);
    setMsg(error ? error.message : 'Rescheduled ✓ (audit logged).');
    void loadDay();
  }

  async function cancel(id: string) {
    if (!confirm('Cancel this appointment?')) return;
    const { error } = await sb.from('appointments').update({ status: 'cancelled' }).eq('id', id);
    setMsg(error ? error.message : 'Cancelled ✓ (audit logged).');
    void loadDay();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Book appointment</h1>
        <p className="text-sm text-slate-400">Select a doctor, pick a slot, then confirm the patient.</p>
      </div>
      {msg && <p className="text-sm text-slate-300">{msg}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="dk-panel space-y-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="dk-step">1</span> Doctor and date
          </h2>
          <select className="dk-input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name} · {d.specialty ?? '—'}</option>)}
          </select>
          <input className="dk-input" type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
          <h2 className="flex items-center gap-2 pt-1 font-semibold">
            <span className="dk-step">2</span> Slot
          </h2>
          {unavail.length > 0 ? (
            <p className="text-sm text-red-400">Doctor unavailable on this date ({unavail[0].reason ?? 'blocked'}).</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-slate-500">No working hours / slots for this day.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {slots.map((s) => (
                <button
                  key={s.iso}
                  type="button"
                  disabled={s.taken}
                  onClick={() => setSlotIso(s.iso)}
                  className={`rounded-lg border px-2 py-2 text-sm tabular-nums ${
                    s.taken
                      ? 'border-white/5 text-slate-600 line-through'
                      : slotIso === s.iso
                        ? 'border-[#4ea895] bg-[#0e4a3a] font-semibold text-white'
                        : 'border-white/10 text-slate-200 hover:bg-white/5'
                  }`}
                >
                  {s.time}
                </button>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={book} className="dk-panel space-y-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="dk-step">3</span> Patient and confirm
          </h2>
          <div className="flex gap-2">
            <input className="dk-input" placeholder="Search patient by name" value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)} />
            <button type="button" className="dk-btn-ghost shrink-0" onClick={() => void searchPatients()} title="Find patient">⌕</button>
          </div>
          <select className="dk-input" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">— select patient —</option>
            {patientOpts.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.contact_number ?? ''}</option>)}
          </select>
          <select className="dk-input" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="pre_booked">Pre-booked</option>
            <option value="walk_in">Walk-in</option>
          </select>
          <input className="dk-input" placeholder="Room (optional)" value={room} onChange={(e) => setRoom(e.target.value)} />
          <select
            className="dk-input"
            value={followUpOf}
            onChange={(e) => setFollowUpOf(e.target.value)}
            disabled={!patientId || pastAppts.length === 0}
            title={patientId ? 'Follow-up of a previous visit (optional)' : 'Select a patient first'}
          >
            <option value="">Follow-up of… (optional)</option>
            {pastAppts.map((a) => (
              <option key={a.id} value={a.id}>
                {new Date(a.scheduled_time).toLocaleDateString()} · {a.status}
              </option>
            ))}
          </select>
          <textarea
            className="dk-input"
            rows={2}
            placeholder="Reason for visit"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button className="dk-btn-primary w-full py-2.5" type="submit">Book appointment</button>
          <div className="border-t border-white/5 pt-3">
            <p className="text-xs text-slate-500">Reschedule: pick new slot left, choose appointment, then:</p>
            <div className="mt-2 flex gap-2">
              <select className="dk-input" value={reschedId} onChange={(e) => setReschedId(e.target.value)}>
                <option value="">— appointment —</option>
                {upcoming.map((a) => (
                  <option key={a.id} value={a.id}>
                    {new Date(a.scheduled_time).toLocaleString()} · {a.patient?.full_name} · {a.status}
                  </option>
                ))}
              </select>
              <button type="button" className="dk-btn-ghost shrink-0" onClick={() => void reschedule()}>Move</button>
            </div>
          </div>
        </form>
      </div>

      <div className="dk-panel">
        <h2 className="font-semibold">Upcoming (cancel)</h2>
        <div className="divide-y divide-white/5">
          {upcoming.slice(0, 20).map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="text-slate-300">
                {new Date(a.scheduled_time).toLocaleString()} · {a.patient?.full_name} → {a.doctor?.full_name} · {a.status} · {a.source}
              </span>
              <button className="dk-btn-danger" onClick={() => void cancel(a.id)}>Cancel</button>
            </div>
          ))}
          {upcoming.length === 0 && <p className="py-2 text-sm text-slate-500">No upcoming appointments.</p>}
        </div>
      </div>
    </div>
  );
}
