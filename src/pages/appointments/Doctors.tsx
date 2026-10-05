import { CalendarCheck, CalendarX, Plus, Save, Trash2 } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import { clinicDateKey, clinicWeekDates, formatClinicDate } from '../../lib/clinicTime';
import { useClinicQuery, useAppointmentRevision } from '../../lib/useClinicQuery';
import { invalidateAppointments } from '../../lib/appointmentChanges';
import { scheduleInputError, scheduleBackendError } from '../../lib/scheduleValidation';
import { useEffect, useMemo, useState } from 'react';
import { getStaffClient } from './auth/staffAuth';
import { useStaffAuth } from './auth/staffAuth';
import type { Doctor, DoctorSchedule, DoctorUnavailable } from '../../lib/types';
import { DAY_NAMES } from '../../lib/types';
import { doctorFormError } from '../../lib/formValidation';
import { useMutation } from '../../lib/useMutation';
import QueryState from '../../components/QueryState';

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
  const revision = useAppointmentRevision();
  const [selected, setSelected] = useState<Doctor | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const mutation = useMutation(setMsg);
  const [editForm, setEditForm] = useState({ full_name: '', specialty: '' });
  useEffect(() => { setEditForm({ full_name: selected?.full_name ?? '', specialty: selected?.specialty ?? '' }); }, [selected]);
  const [docForm, setDocForm] = useState({ full_name: '', specialty: '' });
  const [newDoctorId, setNewDoctorId] = useState(() => crypto.randomUUID());
  const [schedForm, setSchedForm] = useState({ day_of_week: 1, start_time: '09:00', end_time: '17:00', slot_duration_minutes: 30 });
  const [unForm, setUnForm] = useState({ date: '', reason: '' });

  const doctorQuery = useClinicQuery<Doctor[]>(`doctors/${revision}`, async (signal) => {
    const { data, error } = await sb.from('doctors').select('*').order('full_name').abortSignal(signal);
    if (error) throw new Error(error.message);
    return (data as Doctor[]) ?? [];
  }, []);
  const doctors = doctorQuery.data;
  const detail = useClinicQuery<{ schedules: DoctorSchedule[]; unavail: DoctorUnavailable[] }>(selected ? `${selected.id}/${revision}` : '', async (signal) => {
    const [s, u] = await Promise.all([
      sb.from('doctor_schedules').select('*').eq('doctor_id', selected!.id).order('day_of_week').abortSignal(signal),
      sb.from('doctor_unavailable_dates').select('*').eq('doctor_id', selected!.id).order('date').abortSignal(signal),
    ]);
    if (s.error || u.error) throw new Error(s.error?.message || u.error!.message);
    return { schedules: s.data as DoctorSchedule[] ?? [], unavail: u.data as DoctorUnavailable[] ?? [] };
  }, { schedules: [], unavail: [] });
  const { schedules, unavail } = detail.data;
  async function removeCalendarRow(table: 'doctor_schedules' | 'doctor_unavailable_dates', id: string) {
    await mutation.run(async () => {
      const { error } = await sb.from(table).delete().eq('id', id);
      if (error) setMsg(error.message);
      else { setMsg(table === 'doctor_schedules' ? 'Working hours removed.' : 'Date unblocked.'); invalidateAppointments(); }
    });
  }

  async function createDoctor(e: React.FormEvent) {
    e.preventDefault();
    await mutation.run(async () => {
      if (!canManage) return;
      const validation = doctorFormError(docForm.full_name, docForm.specialty);
      if (validation) { setMsg(validation); return; }
      const { error } = await sb.from('doctors').insert({ id: newDoctorId, full_name: docForm.full_name.trim(), specialty: docForm.specialty.trim() || null });
      if (error) setMsg(error.message);
      else {
        setMsg('Doctor created.');
        setDocForm({ full_name: '', specialty: '' });
        setNewDoctorId(crypto.randomUUID());
        invalidateAppointments();
      }
    });
  }

  async function toggleActive(d: Doctor) {
    await mutation.run(async () => {
      if (!canManage) return;
      const { data, error } = await sb.from('doctors').update({ is_active: !d.is_active }).eq('id', d.id).select('id').single();
      if (!data && !error) { setMsg('Doctor activation could not be confirmed.'); return; }
      if (!error) {
        invalidateAppointments();
        if (selected?.id === d.id) setSelected({ ...d, is_active: !d.is_active });
      } else setMsg(error.message);
    });
  }

  async function saveDoctor(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !selected) return;
    const validation = doctorFormError(editForm.full_name, editForm.specialty);
    if (validation) { setMsg(validation); return; }
    await mutation.run(async () => {
      const { data, error } = await sb.from('doctors').update({ full_name: editForm.full_name.trim(), specialty: editForm.specialty.trim() || null }).eq('id', selected.id).select('*').single();
      if (error) { setMsg(error.message); return; }
      if (!data) { setMsg('Doctor update could not be confirmed.'); return; }
      setSelected(data as Doctor); setMsg('Doctor details updated. Existing appointments are preserved.'); invalidateAppointments();
    });
  }

  async function addSchedule(e: React.FormEvent) {
    e.preventDefault();
    await mutation.run(async () => {
      if (!canManage || !selected) return;
      const validationError = scheduleInputError(schedForm);
      if (validationError) { setMsg(validationError); return; }
      const { error } = await sb.from('doctor_schedules').insert({ ...schedForm, doctor_id: selected.id });
      if (error) setMsg(scheduleBackendError(error));
      else {
        setMsg('Schedule added.');
        invalidateAppointments();
      }
    });
  }

  async function addUnavail(e: React.FormEvent) {
    e.preventDefault();
    await mutation.run(async () => {
      if (!canManage || !selected) return;
      const { data, error } = await sb.rpc('staff_block_doctor_date', {
        p_doctor_id: selected.id, p_date: unForm.date, p_reason: unForm.reason || null,
    });
    if (error) setMsg(error.code === '23505' ? 'This doctor/date is already blocked.' : error.message);
    else if (!data?.success) {
      setMsg(`${data?.conflict_count ?? 0} appointments conflict. Reschedule or cancel them explicitly before blocking this date.`);
    } else {
      setMsg('Unavailable date blocked.');
      setUnForm({ date: '', reason: '' });
      invalidateAppointments();
    }
    });
  }

  const weekDates = clinicWeekDates();
  const blockedDows = new Set(weekDates.flatMap((date, dow) => unavail.some((u) => u.date === date) ? [dow] : []));
  const openDows = new Set(schedules.map((s) => s.day_of_week));
  const firstBlocked = unavail.find((u) => weekDates.includes(u.date)) ?? null;
  const hoursLine = useMemo(() => {
    if (schedules.length === 0) return 'No hours set';
    const days = [...new Set(schedules.map((x) => WEEK_SHORT[x.day_of_week]))].join('–');
    const starts = schedules.map((x) => x.start_time.slice(0, 5));
    const ends = schedules.map((x) => x.end_time.slice(0, 5));
    return `${days || '—'}, ${fmtTime(starts.sort()[0])} – ${fmtTime(ends.sort()[ends.length - 1])}`;
  }, [schedules]);

  if (doctorQuery.loading || doctorQuery.error) return <QueryState query={doctorQuery} label="doctors" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Doctors</h1>
        {!canManage && (
          <span className="dk-pill bg-amber-500/15 text-amber-400">View only · admin manages schedules</span>
        )}
      </div>
      {(msg || detail.error || doctorQuery.error) && <p className="text-sm text-slate-300">{detail.error || doctorQuery.error || msg}</p>}

      {selected && canManage && <form className="dk-panel flex flex-wrap gap-2" onSubmit={saveDoctor}>
        <input className="dk-input" aria-label="Edit doctor name" value={editForm.full_name} onChange={e => setEditForm({ ...editForm, full_name: e.target.value })} maxLength={200} required />
        <input className="dk-input" aria-label="Edit doctor specialty" value={editForm.specialty} onChange={e => setEditForm({ ...editForm, specialty: e.target.value })} maxLength={120} />
        <button type="submit" className="icon-button dk-btn-primary" disabled={mutation.pending}><AppIcon icon={Save} size={17} />Save doctor details</button>
      </form>}
      <QueryState query={detail} label="doctor calendar" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          {doctors.map((d) => (
            <button disabled={mutation.pending}
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
                    if (!mutation.pending) void toggleActive(d);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') if (!mutation.pending) void toggleActive(d);
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
              <button disabled={mutation.pending} className="icon-button dk-btn-primary" type="submit"><AppIcon icon={Plus} size={17} />Add doctor</button>
            </form>
          )}
        </div>

        <div className="dk-panel h-fit">
          {!selected ? (
            <p className="py-4 text-sm text-slate-500">Select a doctor to see this week's schedule.</p>
          ) : detail.loading || detail.error ? null : (
            <>
              <h2 className="font-semibold">Schedule this week</h2>
              <p className="text-xs text-slate-400">{formatClinicDate(weekDates[0])} – {formatClinicDate(weekDates[6])}</p>
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
                  {formatClinicDate(firstBlocked.date, { weekday: 'long', month: 'short', day: 'numeric' })}
                  {' '}marked unavailable · reason: {firstBlocked.reason ?? '—'}
                </p>
              )}

              <ul className="mt-3 space-y-1 border-t border-white/5 pt-3 text-sm">
                {schedules.map((s) => (
                  <li key={s.id} className="flex justify-between text-slate-300">
                    <span>{DAY_NAMES[s.day_of_week]}: {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)} ({s.slot_duration_minutes}m)</span>
                    {canManage && (
                      <button disabled={mutation.pending}
                        className="icon-button text-red-400 hover:text-red-300"
                        onClick={() => void removeCalendarRow('doctor_schedules', s.id)}
                      >
                        <AppIcon icon={Trash2} size={16} />Remove
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
                      <button disabled={mutation.pending}
                        className="icon-button text-red-400 hover:text-red-300"
                        onClick={() => void removeCalendarRow('doctor_unavailable_dates', u.id)}
                      >
                        <AppIcon icon={CalendarCheck} size={16} />Unblock
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
                    <input className="dk-input" type="number" min={1} max={1440} step={1} value={schedForm.slot_duration_minutes} onChange={(e) => setSchedForm({ ...schedForm, slot_duration_minutes: Number(e.target.value) })} title="Slot minutes" />
                    <input className="dk-input" type="time" step={60} required value={schedForm.start_time} onChange={(e) => setSchedForm({ ...schedForm, start_time: e.target.value })} />
                    <input className="dk-input" type="time" step={60} required value={schedForm.end_time} onChange={(e) => setSchedForm({ ...schedForm, end_time: e.target.value })} />
                    <button disabled={mutation.pending} className="icon-button dk-btn-ghost col-span-2" type="submit"><AppIcon icon={Plus} size={17} />Add working hours</button>
                  </form>
                  <form onSubmit={addUnavail} className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-3">
                    <input className="dk-input" type="date" min={clinicDateKey()} value={unForm.date} onChange={(e) => setUnForm({ ...unForm, date: e.target.value })} required />
                    <input className="dk-input" placeholder="Reason (leave/holiday)" maxLength={500} value={unForm.reason} onChange={(e) => setUnForm({ ...unForm, reason: e.target.value })} />
                    <button disabled={mutation.pending} className="icon-button dk-btn-ghost col-span-2" type="submit"><AppIcon icon={CalendarX} size={17} />Block date</button>
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
