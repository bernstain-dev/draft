import { useEffect, useState } from 'react';
import { getStaffClient } from './auth/staffAuth';
import type { Appointment, AppointmentStatus, Patient } from '../../lib/types';
import { toLocalDateKey, dayRangeIso } from '../../lib/slots';

interface Row extends Appointment {
  patient?: Patient | null;
  doctor?: { full_name: string } | null;
}

const GROUP_ORDER: AppointmentStatus[] = [
  'scheduled', 'checked_in', 'waiting', 'in_progress', 'completed', 'cancelled', 'no_show',
];

const GROUP_TONE: Record<string, string> = {
  scheduled: 'text-slate-300',
  checked_in: 'text-[#4ea895]',
  waiting: 'text-amber-400',
  in_progress: 'text-purple-300',
  completed: 'text-green-400',
  cancelled: 'text-slate-500',
  no_show: 'text-red-400',
};

function actionLabel(from: string, to: AppointmentStatus): { label: string; cls: string } {
  if (to === 'checked_in') return { label: 'Check in', cls: 'dk-btn-ghost w-full' };
  if (from === 'waiting' && to === 'in_progress') return { label: 'Call to room', cls: 'dk-btn-amber w-full' };
  if (to === 'waiting') return { label: 'Move to waiting', cls: 'dk-btn-ghost w-full' };
  if (to === 'completed') return { label: 'Complete visit', cls: 'dk-btn-ghost w-full' };
  if (to === 'cancelled') return { label: 'Cancel', cls: 'dk-btn-danger' };
  return { label: `→ ${to}`, cls: 'dk-btn-ghost' };
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  checked_in: 'Checked in',
  waiting: 'Waiting',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

const ACTIVE: AppointmentStatus[] = ['scheduled', 'checked_in', 'waiting', 'in_progress'];

function forwardOf(status: string): AppointmentStatus | null {
  if (status === 'scheduled') return 'checked_in';
  if (status === 'checked_in') return 'waiting';
  if (status === 'waiting') return 'in_progress';
  if (status === 'in_progress') return 'completed';
  return null;
}

export default function CheckIn() {
  const sb = getStaffClient();
  const [dateKey, setDateKey] = useState(toLocalDateKey(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [roomEdits, setRoomEdits] = useState<Record<string, string>>({});
  const [noteEdits, setNoteEdits] = useState<Record<string, string>>({});

  async function load() {
    const { startIso, endIso } = dayRangeIso(dateKey); // same bounds as Dashboard
    const { data, error } = await sb
      .from('appointments')
      .select('*, patient:patients(id,full_name,contact_number), doctor:doctors(full_name)')
      .gte('scheduled_time', startIso)
      .lte('scheduled_time', endIso)
      .order('scheduled_time');
    if (error) setMsg(error.message);
    setRows((data as unknown as Row[]) ?? []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  async function setStatus(r: Row, status: AppointmentStatus) {
    setMsg(null);
    const room = roomEdits[r.id] ?? r.room ?? null;
    const { error } = await sb.from('appointments').update({ status, room }).eq('id', r.id);
    if (error) setMsg(error.message);
    else {
      setMsg(
        status === 'checked_in'
          ? `Checked in ✓.`
          : `Status → ${status} ✓ (audit logged).`
      );
      void load();
    }
  }

  async function saveNote(r: Row) {
    const note = (noteEdits[r.id] ?? '').trim();
    if (!note) return;
    const { error } = await sb.from('patient_visit_notes').insert({
      patient_id: r.patient_id,
      appointment_id: r.id,
      note,
    });
    setMsg(error ? error.message : 'Visit note saved ✓');
    if (!error) setNoteEdits({ ...noteEdits, [r.id]: '' });
  }

  const dayLabel = new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const groups = GROUP_ORDER.map((s) => ({ status: s, items: rows.filter((r) => r.status === s) })).filter(
    (g) => g.items.length > 0
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Check-in</h1>
        <p className="text-sm text-slate-400">{dayLabel}</p>
      </div>
      <div className="flex items-center gap-2">
        <input className="dk-input" type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
        <button className="dk-btn-ghost shrink-0" onClick={() => void load()}>Reload</button>
      </div>
      {msg && <p className="text-sm text-slate-300">{msg}</p>}

      {groups.length === 0 && (
        <div className="dk-panel"><p className="py-4 text-sm text-slate-500">No appointments on this date.</p></div>
      )}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <div key={g.status}>
            <h2 className={`mb-2 text-xs font-bold uppercase tracking-widest ${GROUP_TONE[g.status]}`}>
              {STATUS_LABEL[g.status] ?? g.status} ({g.items.length})
            </h2>
            <div className="space-y-3">
              {g.items.map((r) => {
                const active = (ACTIVE as string[]).includes(r.status);
                const fwd = forwardOf(r.status);
                return (
                <div key={r.id} className="dk-panel space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">
                      {r.patient?.full_name ?? r.patient_id.slice(0, 8)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {new Date(r.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' · '}{r.doctor?.full_name ?? '—'}
                    {r.checked_in_at ? ` · Checked in ${new Date(r.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                    {r.room ? ` · Room ${r.room}` : ''}
                  </p>
                  {active && fwd && (() => {
                    const a = actionLabel(r.status, fwd);
                    return (
                      <button className={a.cls} onClick={() => void setStatus(r, fwd)}>
                        {a.label}
                      </button>
                    );
                  })()}
                  {active && (
                    <div className="flex gap-3 border-t border-white/5 pt-2 text-xs">
                      <button className="text-red-400/80 hover:text-red-300" onClick={() => void setStatus(r, 'cancelled')}>
                        Cancel
                      </button>
                      <button className="text-slate-500 hover:text-slate-300" onClick={() => void setStatus(r, 'no_show')}>
                        Mark no-show
                      </button>
                    </div>
                  )}
                  {active && (
                    <>
                      <div className="flex gap-2">
                        <input
                          className="dk-input py-1 text-xs"
                          placeholder="Room"
                          value={roomEdits[r.id] ?? r.room ?? ''}
                          onChange={(e) => setRoomEdits({ ...roomEdits, [r.id]: e.target.value })}
                        />
                      </div>
                      <div className="flex gap-2">
                        <input
                          className="dk-input py-1 text-xs"
                          placeholder="Visit note…"
                          value={noteEdits[r.id] ?? ''}
                          onChange={(e) => setNoteEdits({ ...noteEdits, [r.id]: e.target.value })}
                        />
                        <button className="dk-btn-ghost shrink-0 px-3 py-1 text-xs" onClick={() => void saveNote(r)}>Save</button>
                      </div>
                    </>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
