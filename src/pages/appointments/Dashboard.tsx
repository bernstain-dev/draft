import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getStaffClient } from './auth/staffAuth';
import { toLocalDateKey, dayRangeIso } from '../../lib/slots';

interface Row {
  id: string;
  scheduled_time: string;
  status: string;
  room: string | null;
  source: string;
  patient?: { full_name: string } | null;
  doctor?: { full_name: string } | null;
}

const STATUSES = ['all', 'scheduled', 'checked_in', 'waiting', 'in_progress', 'completed', 'cancelled', 'no_show'];

export function statusPill(status: string): string {
  switch (status) {
    case 'waiting':
      return 'bg-amber-500/15 text-amber-400';
    case 'scheduled':
      return 'bg-[#4ea895]/15 text-[#4ea895]';
    case 'completed':
      return 'bg-green-500/15 text-green-400';
    case 'no_show':
      return 'bg-red-500/15 text-red-400';
    case 'cancelled':
      return 'bg-slate-500/15 text-slate-400';
    default:
      return 'bg-slate-500/15 text-slate-300';
  }
}

function monthBounds(dateKey: string): { start: Date; end: Date; year: number; month: number } {
  const [y, m] = dateKey.split('-').map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59), year: y, month: m - 1 };
}

export default function Dashboard() {
  const sb = getStaffClient();
  const [dateKey, setDateKey] = useState(toLocalDateKey(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthCounts, setMonthCounts] = useState<Record<string, number>>({});
  const { start, end, year, month } = useMemo(() => monthBounds(dateKey), [dateKey]);

  // Day list (shared dayRangeIso helper — same bounds as Check-in)
  useEffect(() => {
    const { startIso: s, endIso: e } = dayRangeIso(dateKey);
    sb.from('appointments')
      .select('id,scheduled_time,status,room,source,patient:patients(full_name),doctor:doctors(full_name)')
      .gte('scheduled_time', s)
      .lte('scheduled_time', e)
      .order('scheduled_time')
      .then(({ data }) => {
        const list = (data as unknown as Row[]) ?? [];
        setRows(list);
        const c: Record<string, number> = {};
        for (const r of list) c[r.status] = (c[r.status] ?? 0) + 1;
        setCounts(c);
      });
  }, [dateKey, sb]);

  // Month heat for the mini calendar (one range query, grouped client-side)
  useEffect(() => {
    sb.from('appointments')
      .select('scheduled_time')
      .gte('scheduled_time', start.toISOString())
      .lte('scheduled_time', end.toISOString())
      .limit(3000)
      .then(({ data }) => {
        const c: Record<string, number> = {};
        for (const r of (data as { scheduled_time: string }[]) ?? []) {
          const d = new Date(r.scheduled_time);
          const key = toLocalDateKey(d);
          c[key] = (c[key] ?? 0) + 1;
        }
        setMonthCounts(c);
      });
  }, [start, end, sb]);

  const cells = useMemo(() => {
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (string | null)[] = [];
    for (let i = 0; i < firstDow; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return out;
  }, [year, month]);

  const filtered = statusFilter === 'all' ? rows : rows.filter((r) => r.status === statusFilter);
  const dayLabel = new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{dayLabel}</p>
          <h1 className="text-2xl font-bold">Daily overview</h1>
        </div>
        <Link className="dk-btn-ghost" to="/appointments/booking">
          + New appointment
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="dk-panel">
          <p className="text-xs text-slate-400">Today's total</p>
          <p className="mt-1 text-3xl font-bold">{rows.length}</p>
        </div>
        <div className="dk-panel">
          <p className="text-xs text-slate-400">Waiting</p>
          <p className="mt-1 text-3xl font-bold text-amber-400">{counts['waiting'] ?? 0}</p>
        </div>
        <div className="dk-panel">
          <p className="text-xs text-slate-400">Completed</p>
          <p className="mt-1 text-3xl font-bold text-green-400">{counts['completed'] ?? 0}</p>
        </div>
        <div className="dk-panel">
          <p className="text-xs text-slate-400">No-shows</p>
          <p className="mt-1 text-3xl font-bold text-red-400">{counts['no_show'] ?? 0}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="dk-panel h-fit">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">
              {new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })}
            </h2>
            <input
              className="dk-input max-w-[130px] py-1 text-xs"
              type="month"
              value={`${year}-${String(month + 1).padStart(2, '0')}`}
              onChange={(e) => {
                if (e.target.value) setDateKey(`${e.target.value}-01`);
              }}
            />
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((key, i) =>
              key === null ? (
                <span key={i} />
              ) : (
                <button
                  key={key}
                  onClick={() => setDateKey(key)}
                  title={`${monthCounts[key] ?? 0} appointments`}
                  className={`rounded px-1 py-1.5 text-xs ${
                    key === dateKey
                      ? 'bg-[#0e4a3a] font-bold text-white'
                      : (monthCounts[key] ?? 0) > 0
                        ? 'bg-[#4ea895]/15 font-medium text-[#9fd8cb] hover:bg-[#4ea895]/25'
                        : 'text-slate-400 hover:bg-white/5'
                  }`}
                >
                  {Number(key.slice(8))}
                  {(monthCounts[key] ?? 0) > 0 && (
                    <span className="block text-[10px] text-slate-500">{monthCounts[key]}</span>
                  )}
                </button>
              )
            )}
          </div>
          <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
            <input className="dk-input" type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
            <select className="dk-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="dk-panel">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Today's appointments</h2>
            <span className="text-xs text-slate-500">Showing {filtered.length} of {rows.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="dk-th">Time</th>
                  <th className="dk-th">Patient</th>
                  <th className="dk-th">Doctor</th>
                  <th className="dk-th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="dk-td font-semibold tabular-nums">
                      {new Date(r.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="dk-td">
                      {r.patient?.full_name}
                    </td>
                    <td className="dk-td text-slate-300">{r.doctor?.full_name}</td>
                    <td className="dk-td">
                      <span className={`dk-pill ${statusPill(r.status)}`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="py-4 text-sm text-slate-500">No appointments match this filter.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
