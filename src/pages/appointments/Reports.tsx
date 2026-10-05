import { Calendar, ChevronLeft, ChevronRight, CircleCheck, Download, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import { clinicDateKey, addClinicDays, formatClinicDateTime } from '../../lib/clinicTime';
import { useClinicQuery, useAppointmentRevision } from '../../lib/useClinicQuery';
import { useEffect, useState } from 'react';
import { getStaffClient } from './auth/staffAuth';

import QueryState from '../../components/QueryState';
import { downloadCsv } from '../../lib/csv';
interface AuditRow { id: string; action: string; entity: string; created_at: string }
interface DoctorStat { id: string; name: string; total: number; completed: number; cancelled: number; noShow: number; walkIn: number }
interface PatientStat { id: string; name: string; contact: string; total: number; noShow: number }
interface Report { total: number; noShows: number; cancelled: number; walkIns: number; doctors: { id: string; name: string }[]; perDoctor: DoctorStat[]; perDay: Record<string, number>; noShowPatients: PatientStat[] }
const EMPTY: Report = { total: 0, noShows: 0, cancelled: 0, walkIns: 0, doctors: [], perDoctor: [], perDay: {}, noShowPatients: [] };

const NO_SHOW_FLAG_THRESHOLD = 2; // patients with >=2 no-shows get flagged
const REPEAT_NO_SHOW = 3; // >=3 gets the strong "repeat" badge

export default function Reports() {
  const sb = getStaffClient();
  const revision = useAppointmentRevision();
  const [from, setFrom] = useState(() => addClinicDays(clinicDateKey(), -30));
  const [to, setTo] = useState(() => clinicDateKey());
  const [doctorFilter, setDoctorFilter] = useState('all');
  const [auditAction, setAuditAction] = useState('all');
  const [msg, setMsg] = useState<string | null>(null);

  const [auditPage, setAuditPage] = useState(0);
  useEffect(() => setAuditPage(0), [from, to, auditAction]);
  const validRange = from && to && from <= to;
  const list = useClinicQuery<Report>(validRange ? `${from}/${to}/${doctorFilter}/${revision}` : '', async (signal) => {
    const { data, error } = await sb.rpc('staff_appointment_report', { p_from: from, p_to: to, p_doctor_id: doctorFilter === 'all' ? null : doctorFilter }).abortSignal(signal);
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Report response is missing.');
    return data as Report;
  }, EMPTY);
  const auditQuery = useClinicQuery<{ rows: AuditRow[]; total: number; actions: string[] }>(validRange ? `${from}/${to}/${auditAction}/${auditPage}/${revision}` : '', async (signal) => {
    const { data, error } = await sb.rpc('staff_report_audit', { p_from: from, p_to: to, p_action: auditAction === 'all' ? null : auditAction, p_offset: auditPage * 100, p_limit: 100 }).abortSignal(signal);
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Audit response is missing.');
    return data;
  }, { rows: [], total: 0, actions: [] });
  const doctors = list.data.doctors;
  const report = list.data;
  const stats = { total: report.total, noShowRate: report.total ? report.noShows / report.total * 100 : 0,
    walkInShare: report.total ? report.walkIns / report.total * 100 : 0,
    perDoctorRows: report.perDoctor, perDay: report.perDay, dayKeys: Object.keys(report.perDay).sort(),
    maxDay: Math.max(1, ...Object.values(report.perDay)), noShowPatients: report.noShowPatients };
  const auditFiltered = auditQuery.data.rows;

  function setPreset(days: number) {
    setFrom(addClinicDays(clinicDateKey(), -(days - 1)));
    setTo(clinicDateKey());
  }

  if (list.loading) return <QueryState query={list} label="reports" />;
  if (list.error) return <div><QueryState query={list} label="reports" /><button onClick={() => setPreset(30)}>Reset report to last 30 days</button></div>;
  if (!validRange) return <div role="alert"><AppIcon icon={TriangleAlert} /> Choose a valid date range. <button onClick={() => setPreset(30)}>Reset range</button></div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Reports and admin</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {[
              { label: 'Today', days: 1 },
              { label: '7D', days: 7 },
              { label: '30D', days: 30 },
              { label: '90D', days: 90 },
            ].map((p) => (
              <button key={p.label} className="dk-btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setPreset(p.days)}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <AppIcon icon={Calendar} size={16} />From
            <input className="dk-input max-w-[150px]" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <AppIcon icon={Calendar} size={16} />To
            <input className="dk-input max-w-[150px]" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <AppIcon icon={SlidersHorizontal} size={16} /><select className="dk-input max-w-[160px]" value={doctorFilter} onChange={(e) => setDoctorFilter(e.target.value)}>
            <option value="all">All doctors</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.id.slice(0, 8)}</option>)}
          </select>
        </div>
      </div>
      {(msg || list.error) && <p className="text-sm text-red-400">{list.error || msg}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="dk-panel">
          <p className="text-xs text-slate-400">Total appointments</p>
          <p className="mt-1 text-3xl font-bold">{stats.total}</p>
        </div>
        <div className="dk-panel">
          <p className="text-xs text-slate-400">No-show rate</p>
          <p className="mt-1 text-3xl font-bold text-red-400">{stats.noShowRate.toFixed(1)}%</p>
        </div>
        <div className="dk-panel">
          <p className="text-xs text-slate-400">Walk-in rate</p>
          <p className="mt-1 text-3xl font-bold">{stats.walkInShare.toFixed(0)}%</p>
        </div>
      </div>

      <div className="dk-panel">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Appointments per doctor</h2>
          <button
            className="icon-button dk-btn-ghost px-3 py-1 text-xs"
            onClick={() => downloadCsv('appointments-per-doctor.csv', ['doctor', 'total', 'completed', 'cancelled', 'no_show', 'walk_in'],
              stats.perDoctorRows.map((d) => [d.name, d.total, d.completed, d.cancelled, d.noShow, d.walkIn]))}
          >
            <AppIcon icon={Download} size={16} />CSV
          </button>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="dk-th">Doctor</th>
                <th className="dk-th">Total</th>
                <th className="dk-th">Done</th>
                <th className="dk-th">No-show rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {stats.perDoctorRows.map((d) => (
                <tr key={d.id}>
                  <td className="dk-td font-medium">{d.name}</td>
                  <td className="dk-td">{d.total}</td>
                  <td className="dk-td">{d.completed}</td>
                  <td className={`dk-td font-semibold ${d.noShow > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                    {d.total ? ((d.noShow / d.total) * 100).toFixed(1) : '0.0'}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stats.perDoctorRows.length === 0 && <p className="py-2 text-sm text-slate-500">No data in range.</p>}
        </div>
      </div>

      <div className="dk-panel">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Appointments per day</h2>
          <button
            className="icon-button dk-btn-ghost px-3 py-1 text-xs"
            onClick={() => downloadCsv('appointments-per-day.csv', ['date', 'count'], stats.dayKeys.map((k) => [k, stats.perDay[k]]))}
          >
            <AppIcon icon={Download} size={16} />CSV
          </button>
        </div>
        {stats.dayKeys.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">No data in range.</p>
        ) : (
          <div className="mt-3 flex items-end gap-1 overflow-x-auto" style={{ minHeight: 120 }}>
            {stats.dayKeys.map((k) => (
              <div key={k} className="flex w-10 shrink-0 flex-col items-center" title={`${k}: ${stats.perDay[k]}`}>
                <span className="text-[10px] text-slate-400">{stats.perDay[k]}</span>
                <div className="w-6 rounded-t bg-[#4ea895]" style={{ height: `${Math.max(4, (stats.perDay[k] / stats.maxDay) * 100)}px` }} />
                <span className="text-[9px] text-slate-500">{k.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {stats.noShowPatients.length === 0 ? (
        <div className="dk-panel border-green-500/20 bg-green-500/10">
          <p className="icon-label text-sm font-medium text-green-400"><AppIcon icon={CircleCheck} size={16} />No repeat no-shows in this range.</p>
        </div>
      ) : (
        <div className="dk-panel">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">No-show tracking (flagged ≥ {NO_SHOW_FLAG_THRESHOLD})</h2>
            <button
              className="icon-button dk-btn-ghost px-3 py-1 text-xs"
              onClick={() => downloadCsv('no-show-patients.csv', ['patient', 'contact', 'appointments', 'no_shows'],
                stats.noShowPatients.map((p) => [p.name, p.contact, p.total, p.noShow]))}
            >
              <AppIcon icon={Download} size={16} />CSV
            </button>
          </div>
          <div className="mt-2 divide-y divide-white/5 text-sm">
            {stats.noShowPatients.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="font-medium">{p.name}</span>
                <span className="text-slate-500">{p.contact}</span>
                <span className="dk-pill bg-red-500/15 text-red-400">{p.noShow} no-show / {p.total} appts</span>
                {p.noShow >= REPEAT_NO_SHOW && <span className="dk-pill bg-red-600 text-white">repeat no-show — call patient</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dk-panel">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Audit log (admin only)</h2>
          <QueryState query={auditQuery} label="audit log" />
          <select className="dk-input max-w-[180px]" value={auditAction} onChange={(e) => setAuditAction(e.target.value)}>
            <option value="all">all actions</option>
            {auditQuery.data.actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="mt-2 divide-y divide-white/5 text-sm">
          {auditFiltered.map((a) => (
            <div key={a.id} className="py-1.5 text-slate-300">{formatClinicDateTime(a.created_at)} · {a.entity} · {a.action}</div>
          ))}
          {!auditQuery.loading && !auditQuery.error && auditFiltered.length === 0 && <p className="py-2 text-sm text-slate-500">No audit activity in this date range/filter.</p>}
        </div>
        <div className="mt-3 flex gap-3"><button disabled={auditPage === 0 || auditQuery.loading} onClick={() => setAuditPage(p => p - 1)} className="icon-button"><AppIcon icon={ChevronLeft} size={16} />Previous</button><span>{auditQuery.data.total} matching entries · page {auditPage + 1}</span><button disabled={(auditPage + 1) * 100 >= auditQuery.data.total || auditQuery.loading} onClick={() => setAuditPage(p => p + 1)} className="icon-button">Next<AppIcon icon={ChevronRight} size={16} /></button></div>
      </div>
    </div>
  );
}
