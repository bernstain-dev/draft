import { useEffect, useMemo, useState } from 'react';
import { getStaffClient } from './auth/staffAuth';
import { useStaffAuth } from './auth/staffAuth';
import type { Doctor, DoctorSchedule, DoctorUnavailable } from '../../lib/types';
import { DAY_NAMES } from '../../lib/types';

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6]; // Sun–Sat (all doctors run Mon–Sun hours)
const WEEK_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function initials(name: string): string {
  const clean = name.replace(/^Dr\.\s*/i, '').trim().split(/\s+/);
  return ((clean[0]?.[0] ?? '') + (clean[1]?.[0] ?? '')).toUpperCase() || '?';
}

function fmtTime(t: string): string {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

export default function Doctors() {
  const sb = getStaffClient();
  const { role } = useStaffAuth();
  const canManage = role === 'admin';
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selected, setSelected] = useState<Doctor | null>(null);
  const [schedules, setSchedules] = useState<DoctorSchedule[]>([]);
  const [unavail, setUnavail] = useState<DoctorUnavailable[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [docForm, setDocForm] = useState({ full_name: '', specialty: '' });
  const [schedForm, setSchedForm] = useState({ day_of_week: 1, start_time: '09:00', end_time: '17:00', slot_duration_minutes: 30 });
  const [unForm, setUnForm] = useState({ date: '', reason: '' });

  async function loadDoctors() {
    const { data } = await sb.from('doctors').select('*').order('full_name');
    setDoctors((data as Doctor[]) ?? []);
  }
  async function loadDetail(id: string) {
    const [{ data: s }, { data: u }] = await Promise.all([
      sb.from('doctor_schedules').select('*').eq('doctor_id', id).order('day_of_week'),
      sb.from('doctor_unavailable_dates').select('*').eq('doctor_id', id).order('date'),
    ]);
    setSchedules((s as DoctorSchedule[]) ?? []);
    setUnavail((u as DoctorUnavailable[]) ?? []);
  }

  useEffect(() => {
    void loadDoctors();
  }, []);

  useEffect(() => {
    if (selected) void loadDetail(selected.id);
    else {
      setSchedules([]);
      setUnavail([]);
    }
  }, [selected]);

  async function createDoctor(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const { error } = await sb.from('doctors').insert({ full_name: docForm.full_name.trim(), specialty: docForm.specialty.trim() || null });
    if (error) setMsg(error.message);
    else {
      setMsg('Doctor created.');
      setDocForm({ full_name: '', specialty: '' });
      void loadDoctors();
    }
  }

  async function toggleActive(d: Doctor) {
    if (!canManage) return;
    const { error } = await sb.from('doctors').update({ is_active: !d.is_active }).eq('id', d.id);
    if (!error) {
      setDoctors(doctors.map((x) => (x.id === d.id ? { ...x, is_active: !x.is_active } : x)));
      if (selected?.id === d.id) setSelected({ ...d, is_active: !d.is_active });
    }
  }

  async function addSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !selected) return;
    const { error } = await sb.from('doctor_schedules').insert({ ...schedForm, doctor_id: selected.id });
    if (error) setMsg(error.message);
    else {
      setMsg('Schedule added.');
      void loadDetail(selected.id);
    }
  }

  async function addUnavail(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !selected) return;
    const { error } = await sb.from('doctor_unavailable_dates').insert({ doctor_id: selected.id, date: unForm.date, reason: unForm.reason || null });
    if (error) setMsg(error.message);
    else {
      setMsg('Unavailable date blocked.');
      setUnForm({ date: '', reason: '' });
      void loadDetail(selected.id);
    }
  }

  const blockedDows = useMemo(() => {
    const s = new Set<number>();
    for (const u of unavail) s.add(new Date(`${u.date}T12:00:00`).getDay());
    return s;
  }, [unavail]);
  const openDows = useMemo(() => new Set(schedules.map((x) => x.day_of_week)), [schedules]);
  const firstBlocked = unavail[0] ?? null;
  const hoursLine = useMemo(() => {
    if (schedules.length === 0) return 'No hours set';
    const days = [...new Set(schedules.map((x) => WEEK_SHORT[x.day_of_week]))].join('–');
    const starts = schedules.map((x) => x.start_time.slice(0, 5));
    const ends = schedules.map((x) => x.end_time.slice(0, 5));
    return `${days || '—'}, ${fmtTime(starts.sort()[0])} – ${fmtTime(ends.sort()[ends.length - 1])}`;
  }, [schedules]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Doctors</h1>
        {!canManage && (
          <span className="dk-pill bg-amber-500/15 text-amber-400">View only · admin manages schedules</span>
        )}
      </div>
      {msg && <p className="text-sm text-slate-300">{msg}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          {doctors.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelected(d)}
              className={`dk-panel flex w-full items-center gap-3 text-left transition-colors ${
                selected?.id === d.id ? 'border-[#4ea895]/50' : 'hover:border-white/10'
              }`}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0e4a3a]/25 text-sm font-bold text-[#9fd8cb]">
                {initials(d.full_name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{d.full_name}</span>
                <span className="block truncate text-xs text-slate-400">{d.specialty ?? '—'}</span>
              </span>
              {!d.is_active && <span className="dk-pill bg-slate-500/15 text-slate-400">inactive</span>}
              {canManage && (
                <span
                  role="button"
                  tabIndex={0}
                  className="shrink-0 text-xs text-slate-400 hover:text-slate-200"
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleActive(d);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void toggleActive(d);
                  }}
                >
                  {d.is_active ? 'Deactivate' : 'Activate'}
                </span>
              )}
            </button>
          ))}
          {doctors.length === 0 && (
            <div className="dk-panel"><p className="text-sm text-slate-500">No doctors yet.</p></div>
          )}
          {canManage && (
            <form onSubmit={createDoctor} className="dk-panel space-y-2">
              <h2 className="text-sm font-semibold">Add doctor</h2>
              <input className="dk-input" placeholder="Full name *" value={docForm.full_name} onChange={(e) => setDocForm({ ...docForm, full_name: e.target.value })} required />
              <input className="dk-input" placeholder="Specialty" value={docForm.specialty} onChange={(e) => setDocForm({ ...docForm, specialty: e.target.value })} />
              <button className="dk-btn-primary" type="submit">Add doctor</button>
            </form>
          )}
        </div>

        <div className="dk-panel h-fit">
          {!selected ? (
            <p className="py-4 text-sm text-slate-500">Select a doctor to see this week's schedule.</p>
          ) : (
            <>
              <h2 className="font-semibold">Schedule this week</h2>
              <p className="mt-1 text-xs text-slate-500">◷ {selected.full_name} · {hoursLine}</p>
              <div className="mt-3 grid grid-cols-7 gap-2 text-center">
                {WEEK_DAYS.map((dow) => {
                  const blocked = blockedDows.has(dow);
                  const open = openDows.has(dow);
                  return (
                    <div key={dow}>
                      <p className="mb-1 text-xs text-slate-400">{WEEK_SHORT[dow]}</p>
                      <p
                        className={`rounded-lg px-1 py-1.5 text-xs font-semibold ${
                          blocked ? 'bg-red-500/20 text-red-400' : open ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-slate-500'
                        }`}
                      >
                        {blocked ? 'Leave' : open ? 'Open' : '—'}
                      </p>
                    </div>
                  );
                })}
              </div>
              {firstBlocked && (
                <p className="mt-2 text-xs text-slate-500">
                  {new Date(`${firstBlocked.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })}
                  {' '}marked unavailable · reason: {firstBlocked.reason ?? '—'}
                </p>
              )}

              <ul className="mt-3 space-y-1 border-t border-white/5 pt-3 text-sm">
                {schedules.map((s) => (
                  <li key={s.id} className="flex justify-between text-slate-300">
                    <span>{DAY_NAMES[s.day_of_week]}: {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)} ({s.slot_duration_minutes}m)</span>
                    {canManage && (
                      <button
                        className="text-red-400 hover:text-red-300"
                        onClick={() => void sb.from('doctor_schedules').delete().eq('id', s.id).then(() => selected && loadDetail(selected.id))}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <ul className="mt-2 space-y-1 text-sm">
                {unavail.map((u) => (
                  <li key={u.id} className="flex justify-between text-slate-300">
                    <span>Blocked {u.date} {u.reason ? `— ${u.reason}` : ''}</span>
                    {canManage && (
                      <button
                        className="text-red-400 hover:text-red-300"
                        onClick={() => void sb.from('doctor_unavailable_dates').delete().eq('id', u.id).then(() => selected && loadDetail(selected.id))}
                      >
                        Unblock
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {canManage && (
                <>
                  <form onSubmit={addSchedule} className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-3">
                    <select className="dk-input" value={schedForm.day_of_week} onChange={(e) => setSchedForm({ ...schedForm, day_of_week: Number(e.target.value) })}>
                      {DAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
                    </select>
                    <input className="dk-input" type="number" min={5} step={5} value={schedForm.slot_duration_minutes} onChange={(e) => setSchedForm({ ...schedForm, slot_duration_minutes: Number(e.target.value) })} title="Slot minutes" />
                    <input className="dk-input" type="time" value={schedForm.start_time} onChange={(e) => setSchedForm({ ...schedForm, start_time: e.target.value })} />
                    <input className="dk-input" type="time" value={schedForm.end_time} onChange={(e) => setSchedForm({ ...schedForm, end_time: e.target.value })} />
                    <button className="dk-btn-ghost col-span-2" type="submit">Add working hours</button>
                  </form>
                  <form onSubmit={addUnavail} className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-3">
                    <input className="dk-input" type="date" value={unForm.date} onChange={(e) => setUnForm({ ...unForm, date: e.target.value })} required />
                    <input className="dk-input" placeholder="Reason (leave/holiday)" value={unForm.reason} onChange={(e) => setUnForm({ ...unForm, reason: e.target.value })} />
                    <button className="dk-btn-ghost col-span-2" type="submit">Block date</button>
                  </form>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
