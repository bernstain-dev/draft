import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPatientClient, usePatientAuth } from './auth/patientAuth';
import type { Appointment, Doctor } from '../../lib/types';
import { formatDateShort, formatTime, patientStatusLabel, patientStatusPill } from '../../lib/patient';

interface Row extends Appointment {
  doctor?: Doctor | null;
}

const HISTORY = ['completed', 'cancelled', 'no_show'];

export default function AppointmentHistory() {
  const sb = getPatientClient();
  const { patient } = usePatientAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState('all');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!patient) return;
    sb.from('appointments')
      .select('*, doctor:doctors(*)')
      .eq('patient_id', patient.id)
      .in('status', HISTORY)
      .order('scheduled_time', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) setMsg(error.message);
        else setRows((data as Row[]) ?? []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => patientStatusLabel(r.status) === filter)),
    [rows, filter]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Appointment History</h1>
          <p className="text-sm text-slate-400">Your past and closed visits.</p>
        </div>
        <Link className="dk-btn-primary" to="/patient/book">
          + Book an Appointment
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="hist-filter" className="text-xs text-slate-400">Show</label>
        <select
          id="hist-filter"
          className="dk-input max-w-[200px]"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
          <option value="No-show">No-show</option>
        </select>
      </div>

      {msg && <p role="status" className="text-sm text-slate-300">{msg}</p>}

      {filtered.length === 0 ? (
        <div className="dk-panel mx-auto max-w-md space-y-2 py-10 text-center">
          <h2 className="text-lg font-semibold">No History Yet</h2>
          <p className="text-sm text-slate-400">Your completed and past appointments will appear here.</p>
          <Link to="/patient/book" className="dk-btn-primary mt-2 inline-block">
            Book an Appointment
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((a) => (
            <article key={a.id} className="dk-panel space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Appointment with {a.doctor?.full_name ?? 'your doctor'}</h2>
                  <p className="text-xs text-slate-400">{a.doctor?.specialty ?? 'General Medicine'}</p>
                </div>
                <span className={`dk-pill ${patientStatusPill(a.status)}`}>{patientStatusLabel(a.status)}</span>
              </div>
              <p className="text-sm tabular-nums text-slate-300">
                {formatDateShort(a.scheduled_time)}
                <span className="mx-2 text-slate-600">·</span>
                {formatTime(a.scheduled_time)}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
