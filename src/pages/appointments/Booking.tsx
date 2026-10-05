import { CalendarDays, CalendarPlus, ChevronRight, CircleX, Search } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import { notifyAppointment } from '../../lib/notifications';
import { useMutation } from '../../lib/useMutation';
import QueryState from '../../components/QueryState';
import { useEffect, useMemo, useState } from 'react';
import { getStaffClient } from './auth/staffAuth';
import type { Appointment, Doctor, Patient } from '../../lib/types';
import { clinicDateKey, formatClinicDate, formatClinicDateTime } from '../../lib/clinicTime';
import { useAvailability } from '../../lib/useAvailability';
import { useClinicQuery, useAppointmentRevision } from '../../lib/useClinicQuery';
import { appointmentMutationSucceeded } from '../../lib/appointmentChanges';

export default function Booking() {
  const sb = getStaffClient();
  const revision = useAppointmentRevision();
  const [doctorId, setDoctorId] = useState('');
  const [dateKey, setDateKey] = useState(clinicDateKey());
  const [slotIso, setSlotIso] = useState('');
  const [patientQuery, setPatientQuery] = useState('');
  const [patientId, setPatientId] = useState('');
  const [source, setSource] = useState<'pre_booked' | 'walk_in'>('pre_booked');
  const [room, setRoom] = useState('');
  const [followUpOf, setFollowUpOf] = useState('');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const mutation = useMutation(setMsg);
  // reschedule
  const [reschedId, setReschedId] = useState('');

  const doctorQuery = useClinicQuery<Doctor[]>(`doctors/${revision}`, async (signal) => {
    const { data, error } = await sb.from('doctors').select('*').eq('is_active', true).order('full_name').abortSignal(signal);
    if (error) throw new Error(error.message);
    return (data as Doctor[]) ?? [];
  }, []);
  const doctors = doctorQuery.data;
  useEffect(() => { if (!doctorId && doctors.length) setDoctorId(doctors[0].id); }, [doctors, doctorId]);
  const availability = useAvailability(sb, doctorId, dateKey);
  const slots = availability.data;
  useEffect(() => { setSlotIso(''); }, [doctorId, dateKey, revision]);
  const upcomingQuery = useClinicQuery<(Appointment & { patient?: Patient; doctor?: Doctor })[]>(`upcoming/${revision}`, async (signal) => {
    const { data, error } = await sb.from('appointments').select('*, patient:patients(*), doctor:doctors(*)')
      .in('status', ['pending', 'scheduled', 'checked_in', 'waiting', 'in_progress']).order('scheduled_time').limit(50).abortSignal(signal);
    if (error) throw new Error(error.message);
    return data as unknown as (Appointment & { patient?: Patient; doctor?: Doctor })[] ?? [];
  }, []);
  const upcoming = upcomingQuery.data;
  const pastQuery = useClinicQuery<Appointment[]>(patientId ? `past/${patientId}/${revision}` : '', async (signal) => {
    const { data, error } = await sb.from('appointments').select('*').eq('patient_id', patientId)
      .order('scheduled_time', { ascending: false }).limit(20).abortSignal(signal);
    if (error) throw new Error(error.message);
    return (data as Appointment[]) ?? [];
  }, []);
  const pastAppts = pastQuery.data;
  useEffect(() => { setFollowUpOf(''); }, [patientId]);
  const [searchRequest, setSearchRequest] = useState({ query: '', serial: 0 });
  const patientSearch = useClinicQuery<Patient[]>(searchRequest.serial && searchRequest.query === patientQuery.trim()
    ? `patients/${searchRequest.query}/${searchRequest.serial}` : '', async (signal) => {
      const { data, error } = await sb.from('patients').select('*').ilike('full_name', `%${searchRequest.query}%`).limit(10).abortSignal(signal);
      if (error) throw new Error(error.message);
      return (data as Patient[]) ?? [];
    }, []);
  const patientOpts = patientSearch.data;
  function searchPatients() { setSearchRequest((r) => ({ query: patientQuery.trim(), serial: r.serial + 1 })); }
  const queryError = doctorQuery.error || availability.error || upcomingQuery.error || pastQuery.error || patientSearch.error;

  // Belt-and-braces: recurrence_parent_id is uuid — never submit raw text.
  const isUuid = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());

  async function book(e: React.FormEvent) {
    e.preventDefault();
    await mutation.run(async () => {
      setMsg(null);
      if (!doctorId || !slotIso || !patientId) { setMsg('Pick doctor, slot, and patient.'); return; }
      const { data, error } = await sb.rpc('staff_book_appointment', {
        p_patient_id: patientId, p_doctor_id: doctorId, p_scheduled_time: slotIso, p_source: source,
        p_room: room || null, p_reason: notes.trim() || null, p_recurrence_parent_id: isUuid(followUpOf) ? followUpOf.trim() : null,
      });
      if (error) { setMsg(error.code === '23505' ? 'Slot just taken (double-booking blocked). Pick another slot.' : error.message); return; }
      if (!appointmentMutationSucceeded({ data, error }) || !data?.id) { setMsg('Booking could not be confirmed.'); return; }
      setSlotIso(''); setNotes('');
      setMsg('Booked.' + await notifyAppointment(sb, data.id, 'confirmation'));
    });
  }

  async function reschedule() {
    await mutation.run(async () => {
      if (!reschedId || !slotIso) { setMsg('Select an appointment and a new slot to reschedule.'); return; }
      const id = reschedId;
      const { data, error } = await sb.rpc('staff_reschedule_appointment', { p_appointment_id: id, p_doctor_id: doctorId, p_scheduled_time: slotIso });
      if (error) setMsg(error.message);
      else if (!appointmentMutationSucceeded({ data, error })) setMsg('Rescheduling could not be confirmed.');
      else { setReschedId(''); setMsg('Rescheduled (audit logged).' + await notifyAppointment(sb, id, 'reschedule')); }
    });
  }

  async function cancel(id: string) {
    if (mutation.pending || !confirm('Cancel this appointment?')) return;
    await mutation.run(async () => {
      const { data, error } = await sb.rpc('staff_cancel_appointment', { p_appointment_id: id });
      if (error) setMsg(error.message);
      else if (!appointmentMutationSucceeded({ data, error })) setMsg('Cancellation could not be confirmed.');
      else setMsg('Cancelled (audit logged).' + await notifyAppointment(sb, id, 'cancellation'));
    });
  }

  if (doctorQuery.loading || doctorQuery.error) return <QueryState query={doctorQuery} label="doctors" />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Book appointment</h1>
        <p className="text-sm text-slate-400">Select a doctor, pick a slot, then confirm the patient.</p>
      </div>
      {(msg || queryError) && <p className="text-sm text-slate-300">{queryError || msg}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="dk-panel space-y-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="dk-step">1</span> Doctor and date
          </h2>
          <select className="dk-input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name} · {d.specialty ?? '—'}</option>)}
          </select>
          <input className="dk-input" type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
          <QueryState query={patientSearch} label="patient search" /><QueryState query={pastQuery} label="patient visits" />
          <h2 className="flex items-center gap-2 pt-1 font-semibold">
            <span className="dk-step">2</span> Slot
          </h2>
          {availability.loading ? <p>Loading available times…</p> : availability.error ? (
            <QueryState query={availability} label="available times" />
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
            <button disabled={mutation.pending} type="button" className="icon-button dk-btn-ghost shrink-0" onClick={() => void searchPatients()} title="Find patient" aria-label="Find patient"><AppIcon icon={Search} size={17} /></button>
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
            title={patientId ? 'Follow-up of one of the 20 most recent visits (optional)' : 'Select a patient first'}
          >
            <option value="">Follow-up of… (optional)</option>
            {pastAppts.map((a) => (
              <option key={a.id} value={a.id}>
                {formatClinicDate(a.scheduled_time)} · {a.status}
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
          <button disabled={mutation.pending} className="icon-button dk-btn-primary w-full py-2.5" type="submit"><AppIcon icon={CalendarPlus} size={17} />Book appointment</button>
          <div className="border-t border-white/5 pt-3">
            <p className="text-xs text-slate-500">Reschedule: pick new slot left, choose appointment, then:</p>
            <div className="mt-2 flex gap-2">
              <select className="dk-input" value={reschedId} onChange={(e) => setReschedId(e.target.value)}>
                <option value="">— appointment —</option>
                {upcoming.filter((a) => ['pending', 'scheduled'].includes(a.status)).map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatClinicDateTime(a.scheduled_time)} · {a.patient?.full_name} · {a.status}
                  </option>
                ))}
              </select>
              <button disabled={mutation.pending} type="button" className="icon-button dk-btn-ghost shrink-0" onClick={() => void reschedule()}><AppIcon icon={CalendarDays} size={17} />Move</button>
            </div>
          </div>
        </form>
      </div>

      <div className="dk-panel">
        <QueryState query={upcomingQuery} label="upcoming appointments" />
        <h2 className="font-semibold">Upcoming (cancel)</h2>
        <p className="text-xs text-slate-500">Showing the next 20 active appointments. The move selector lists the next 50.</p>
        <div className="divide-y divide-white/5">
          {upcoming.slice(0, 20).map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="text-slate-300">
                {formatClinicDateTime(a.scheduled_time)} · {a.patient?.full_name} <AppIcon icon={ChevronRight} size={16} /> {a.doctor?.full_name} · {a.status} · {a.source}
              </span>
              <button disabled={mutation.pending} className="icon-button dk-btn-danger" onClick={() => void cancel(a.id)}><AppIcon icon={CircleX} size={17} />Cancel</button>
            </div>
          ))}
          {!upcomingQuery.loading && !upcomingQuery.error && upcoming.length === 0 && <p className="py-2 text-sm text-slate-500">No upcoming appointments.</p>}
        </div>
      </div>
    </div>
  );
}
