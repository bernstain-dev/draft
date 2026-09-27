import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPatientClient, usePatientAuth } from './auth/patientAuth';
import type { Appointment, Doctor } from '../../lib/types';
import { formatDateShort, formatTime, patientStatusLabel, patientStatusPill } from '../../lib/patient';

interface Row extends Appointment {
  doctor?: Doctor | null;
}

const UPCOMING = ['pending', 'scheduled', 'confirmed', 'checked_in', 'waiting', 'in_progress'];

export default function PatientDashboard() {
  const sb = getPatientClient();
  const { profile, patient } = usePatientAuth();
  const [upcoming, setUpcoming] = useState<Row[]>([]);
  const [doctorCount, setDoctorCount] = useState(0);
  const [pastCount, setPastCount] = useState(0);

  useEffect(() => {
    sb.from('doctors').select('id', { count: 'exact', head: true }).eq('is_active', true).then(({ count }) => {
      setDoctorCount(count ?? 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!patient) return;
    sb.from('appointments')
      .select('*, doctor:doctors(*)')
      .eq('patient_id', patient.id)
      .in('status', UPCOMING)
      .order('scheduled_time')
      .then(({ data }) => setUpcoming((data as Row[]) ?? []));
    sb.from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patient.id)
      .in('status', ['completed', 'cancelled', 'no_show'])
      .then(({ count }) => setPastCount(count ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  const next = useMemo(() => {
    const now = Date.now();
    return [...upcoming].sort((a, b) => +new Date(a.scheduled_time) - +new Date(b.scheduled_time)).find(
      (a) => +new Date(a.scheduled_time) >= now - 60 * 60 * 1000
    ) ?? upcoming[0] ?? null;
  }, [upcoming]);

  const firstName = (profile?.full_name ?? '').split(' ')[0] || 'there';

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-400">Good day, {firstName}!</p>
        <h1 className="text-2xl font-bold">Dashboard</h1>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="dk-panel">
          <p className="text-xs text-slate-400">Upcoming Appointment</p>
          {next ? (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-semibold">Appointment with {next.doctor?.full_name ?? 'your doctor'}</p>
              <p className="text-xs text-slate-400 tabular-nums">
                {formatDateShort(next.scheduled_time)} · {formatTime(next.scheduled_time)}
              </p>
              <Link to="/patient/appointments" className="dk-btn-ghost mt-2 inline-block px-3 py-1.5 text-xs">
                View Appointment
              </Link>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-slate-500">No upcoming visits.</p>
              <Link to="/patient/book" className="dk-btn-primary inline-block px-3 py-1.5 text-xs">
                Book an Appointment
              </Link>
            </div>
          )}
        </div>

        <Link to="/patient/appointments" className="dk-panel transition-colors hover:border-white/15">
          <p className="text-xs text-slate-400">My Appointments</p>
          <p className="mt-1 text-3xl font-bold">{upcoming.length}</p>
          <p className="mt-1 text-xs text-[#4ea895]">View your visits →</p>
        </Link>

        <Link to="/patient/book" className="dk-panel transition-colors hover:border-white/15">
          <p className="text-xs text-slate-400">Available Doctors</p>
          <p className="mt-1 text-3xl font-bold">{doctorCount}</p>
          <p className="mt-1 text-xs text-[#4ea895]">Choose a doctor →</p>
        </Link>

        <Link to="/patient/history" className="dk-panel transition-colors hover:border-white/15">
          <p className="text-xs text-slate-400">Appointment History</p>
          <p className="mt-1 text-3xl font-bold">{pastCount}</p>
          <p className="mt-1 text-xs text-[#4ea895]">View history →</p>
        </Link>
      </div>

      {next && (
        <div className="dk-panel">
          <h2 className="font-semibold">Upcoming Appointment</h2>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm">
                Appointment with <span className="font-semibold">{next.doctor?.full_name ?? 'your doctor'}</span>
              </p>
              <p className="text-xs text-slate-400">
                {next.doctor?.specialty ?? 'General Medicine'} · {formatDateShort(next.scheduled_time)} · {formatTime(next.scheduled_time)}
              </p>
            </div>
            <span className={`dk-pill ${patientStatusPill(next.status)}`}>{patientStatusLabel(next.status)}</span>
          </div>
        </div>
      )}

      <div className="dk-panel">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">My Appointments</h2>
          <Link to="/patient/appointments" className="text-xs text-[#4ea895] hover:underline">View all →</Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">You don&apos;t have any scheduled appointments yet.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {upcoming.slice(0, 5).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-slate-300">
                  Appointment with {a.doctor?.full_name ?? 'your doctor'} · {formatDateShort(a.scheduled_time)} · {formatTime(a.scheduled_time)}
                </span>
                <span className={`dk-pill ${patientStatusPill(a.status)}`}>{patientStatusLabel(a.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
