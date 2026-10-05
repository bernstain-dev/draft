import { CalendarDays, CalendarPlus, ChevronDown, ChevronUp } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import { notifyAppointment } from '../../lib/notifications';
import { useMutation } from '../../lib/useMutation';
import QueryState from '../../components/QueryState';
import { useClinicQuery, useAppointmentRevision } from '../../lib/useClinicQuery';
import { appointmentMutationSucceeded } from '../../lib/appointmentChanges';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPatientClient, usePatientAuth } from './auth/patientAuth';
import type { Appointment, Doctor } from '../../lib/types';
import { formatDateShort, formatTime, patientStatusLabel, patientStatusPill } from '../../lib/patient';

interface Row extends Appointment {
  doctor?: Doctor | null;
}

const UPCOMING = ['pending', 'scheduled', 'checked_in', 'waiting', 'in_progress'];

export default function MyAppointments() {
  const sb = getPatientClient();
  const { patient } = usePatientAuth();
  const nav = useNavigate();
  const revision = useAppointmentRevision();
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState('');
  const [busyId, setBusyId] = useState('');
  const mutation = useMutation(setMsg);

  const list = useClinicQuery<Row[]>(patient ? `${patient.id}/${revision}` : '', async (signal) => {
    const { data, error } = await sb.from('appointments').select('*, doctor:doctors(*)')
      .eq('patient_id', patient!.id).in('status', UPCOMING).order('scheduled_time').abortSignal(signal);
    if (error) throw new Error(error.message);
    return (data as Row[]) ?? [];
  }, []);
  const rows = list.data;

  const sorted = useMemo(
    () => [...rows].sort((a, b) => +new Date(a.scheduled_time) - +new Date(b.scheduled_time)),
    [rows]
  );

  async function cancelAppointment(id: string) {
    await mutation.run(async () => {
      if (!confirm('Cancel this appointment?')) return;
      setBusyId(id);
      setMsg(null);
      try {
        const rpc = await sb.rpc('cancel_appointment', { p_appointment_id: id });
        if (rpc.error) {
          setMsg(rpc.error.message);
          return;
        }
        if (!appointmentMutationSucceeded(rpc)) { setMsg('Cancellation could not be confirmed.'); return; }
        setMsg('Your appointment has been cancelled.' + await notifyAppointment(sb, id, 'cancellation'));
      } finally {
        setBusyId('');
      }
    });
  }

  if (!patient) {
    return (
      <div className="dk-panel text-center">
        <p className="py-4 text-sm text-slate-400">Loading your profile…</p>
      </div>
    );
  }

  if (list.loading || list.error) return <QueryState query={list} label="appointments" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Appointments</h1>
          <p className="text-sm text-slate-400">View, reschedule, or cancel your upcoming visits.</p>
        </div>
        <Link className="icon-button dk-btn-primary" to="/patient/book">
          <AppIcon icon={CalendarPlus} size={17} />Book an Appointment
        </Link>
      </div>

      {(msg || list.error) && <p role="status" className="text-sm text-slate-300">{list.error || msg}</p>}

      {sorted.length === 0 ? (
        <div className="dk-panel mx-auto max-w-md space-y-2 py-10 text-center">
          <p className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-2xl"><AppIcon icon={CalendarDays} size={24} /></p>
          <h2 className="text-lg font-semibold">No Appointments Yet</h2>
          <p className="text-sm text-slate-400">You don&apos;t have any scheduled appointments yet.</p>
          <Link to="/patient/book" className="dk-btn-primary mt-2 inline-block">
            Book an Appointment
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sorted.map((a) => {
            const open = expanded === a.id;
            return (
              <article key={a.id} className="dk-panel space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">Appointment with {a.doctor?.full_name ?? 'your doctor'}</h2>
                    <p className="text-xs text-slate-400">{a.doctor?.specialty ?? 'General Medicine'}</p>
                  </div>
                  <span className={`dk-pill ${patientStatusPill(a.status)}`}>{patientStatusLabel(a.status)}</span>
                </div>
                <p className="text-sm tabular-nums">
                  {formatDateShort(a.scheduled_time)}
                  <span className="mx-2 text-slate-600">·</span>
                  {formatTime(a.scheduled_time)}
                </p>
                {open && (
                  <dl className="space-y-1 rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">Doctor</dt><dd>{a.doctor?.full_name ?? '—'}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">Specialty</dt><dd>{a.doctor?.specialty ?? '—'}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">Date</dt><dd>{formatDateShort(a.scheduled_time)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">Time</dt><dd>{formatTime(a.scheduled_time)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">Status</dt><dd>{patientStatusLabel(a.status)}</dd></div>
                  </dl>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="icon-button dk-btn-ghost flex-1" onClick={() => setExpanded((v) => (v === a.id ? '' : a.id))}>
                    <AppIcon icon={open ? ChevronUp : ChevronDown} size={16} />{open ? 'Hide Details' : 'View Details'}
                  </button>
                  <button type="button" className="icon-button dk-btn-ghost flex-1" disabled={!['pending', 'scheduled'].includes(a.status)} onClick={() => nav(`/patient/book?reschedule=${a.id}`)}>
                    <AppIcon icon={CalendarDays} size={16} />Reschedule
                  </button>
                  <button
                    type="button"
                    className="dk-btn-danger flex-1"
                    disabled={mutation.pending || busyId === a.id || !['pending', 'scheduled'].includes(a.status)}
                    onClick={() => void cancelAppointment(a.id)}
                  >
                    {busyId === a.id ? 'Cancelling…' : 'Cancel Appointment'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
