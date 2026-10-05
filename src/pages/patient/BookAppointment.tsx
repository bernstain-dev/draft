import { Calendar, ChevronLeft, ChevronRight, CircleCheck, Clock } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import { notifyAppointment } from '../../lib/notifications';
import { useMutation } from '../../lib/useMutation';
import QueryState from '../../components/QueryState';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getPatientClient, usePatientAuth } from './auth/patientAuth';
import type { Appointment, Doctor, DoctorSchedule } from '../../lib/types';
import { clinicDateKey, clinicWeekday, formatClinicDate } from '../../lib/clinicTime';
import { useAvailability } from '../../lib/useAvailability';
import { useClinicQuery, useAppointmentRevision } from '../../lib/useClinicQuery';
import { appointmentMutationSucceeded } from '../../lib/appointmentChanges';
import {
  MSG,
  formatDateLong,
  formatDateShort,
  formatSlotTime,
  formatTime,
  patientStatusLabel,
} from '../../lib/patient';

type Step = 'doctor' | 'date' | 'time' | 'review' | 'success';

const NEXT_DAYS = 30;

function initials(name: string): string {
  const clean = name.replace(/^Dr\.\s*/i, '').trim().split(/\s+/);
  return ((clean[0]?.[0] ?? '') + (clean[1]?.[0] ?? '')).toUpperCase() || '?';
}

function dayLabel(dow: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];
}

interface BookedSummary {
  id: string;
  doctorName: string;
  specialty: string;
  dateKey: string;
  time: string;
}

export default function BookAppointment() {
  const sb = getPatientClient();
  const { profile, patient, refreshPatient } = usePatientAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const rescheduleId = params.get('reschedule') ?? '';
  const preselectDoctor = params.get('doctor') ?? '';

  const [step, setStep] = useState<Step>('doctor');
  const revision = useAppointmentRevision();
  const [doctorId, setDoctorId] = useState(preselectDoctor);
  const [expandedDoctor, setExpandedDoctor] = useState('');

  const [dateKey, setDateKey] = useState('');
  const [slotIso, setSlotIso] = useState('');
  const [slotTime, setSlotTime] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const mutation = useMutation(setMsg);
  const busy = mutation.pending;
  const [summary, setSummary] = useState<BookedSummary | null>(null);

  const doctorQuery = useClinicQuery<Doctor[]>(`doctors/${revision}`, async (signal) => {
    const { data, error } = await sb.from('doctors').select('*').eq('is_active', true).order('full_name').abortSignal(signal);
    if (error) throw new Error(error.message);
    return (data as Doctor[]) ?? [];
  }, []);
  const doctors = doctorQuery.data;
  const doctor = doctors.find((d) => d.id === doctorId) ?? null;
  const rescheduleQuery = useClinicQuery<Appointment | null>(rescheduleId && patient ? `${patient.id}/${rescheduleId}/${revision}` : '', async (signal) => {
    const { data, error } = await sb.from('appointments').select('*').eq('id', rescheduleId).eq('patient_id', patient!.id).abortSignal(signal).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Appointment not found.');
    return data as Appointment;
  }, null);
  const reschedInfo = rescheduleQuery.data;
  useEffect(() => {
    if (reschedInfo) { setDoctorId(reschedInfo.doctor_id); setReason(reschedInfo.reason ?? ''); }
  }, [reschedInfo?.id]);
  const scheduleQuery = useClinicQuery<DoctorSchedule[]>(doctorId ? `schedules/${doctorId}/${revision}` : '', async (signal) => {
    const { data, error } = await sb.from('doctor_schedules').select('*').eq('doctor_id', doctorId).abortSignal(signal);
    if (error) throw new Error(error.message);
    return (data as DoctorSchedule[]) ?? [];
  }, []);
  const schedules = scheduleQuery.data;
  const today = clinicDateKey();
  const datesQuery = useClinicQuery<{ clinic_date: string; available: boolean }[]>(doctorId ? `dates/${doctorId}/${today}/${revision}` : '', async (signal) => {
    const { data, error } = await sb.rpc('get_available_appointment_dates', { p_doctor_id: doctorId, p_start: today, p_days: NEXT_DAYS }).abortSignal(signal);
    if (error) throw new Error(error.message);
    return data ?? [];
  }, []);
  const dateOptions = datesQuery.data.map((d) => ({ key: d.clinic_date, dow: clinicWeekday(d.clinic_date), available: d.available }));
  const availability = useAvailability(sb, doctorId, dateKey);
  const slots = availability.data;
  const availableSlots = slots;
  useEffect(() => { setSlotIso(''); setSlotTime(''); }, [doctorId, dateKey, revision]);
  const queryError = doctorQuery.error || rescheduleQuery.error || scheduleQuery.error || datesQuery.error || availability.error;

  const doctorDaysLine = useMemo(() => {
    if (schedules.length === 0) return 'Schedule to be announced';
    const days = [...new Set(schedules.map((s) => dayLabel(s.day_of_week)))];
    const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    days.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (days.length === 5 && days[0] === 'Monday' && days[4] === 'Friday') return 'Monday – Friday';
    return days.join(', ');
  }, [schedules]);

  function pickDoctor(id: string) {
    setDoctorId(id);
    setDateKey('');
    setSlotIso('');
    setSlotTime('');
    setMsg(null);
    setStep('date');
  }

  async function confirmBooking() {
    await mutation.run(async () => {
      if (busy) return;
      setMsg(null);
      if (!doctor || !dateKey || !slotIso) {
        setMsg('Please choose a doctor, date, and time first.');
        return;
      }
      if (!patient) {
        await refreshPatient().catch(() => undefined);
        setMsg('Your profile is still loading. Please wait a moment and try again.');
        return;
      }
      if (rescheduleId && !reschedInfo) {
        setMsg('The appointment to reschedule could not be loaded.');
        return;
      }

      try {
        const scheduledTime = slotIso;
        // Fail closed: every mutation must pass database authorization and
        // shared schedule validation. Never fall back to a table write.
        const rpc = rescheduleId
          ? await sb.rpc('reschedule_appointment', {
              p_appointment_id: rescheduleId,
              p_doctor_id: doctor.id,
              p_scheduled_time: scheduledTime,
            })
          : await sb.rpc('book_appointment', {
              p_doctor_id: doctor.id,
              p_scheduled_time: scheduledTime,
              p_reason: reason.trim() || null,
            });
        if (rpc.error) {
          setMsg(rpc.error.code === '23505' ? MSG.conflict : rpc.error.message);
          return;
        }
        const result = rpc.data as { id?: string; success?: boolean } | null;
        if (!result?.success || !result.id) {
          setMsg(MSG.failure);
          return;
        }
        appointmentMutationSucceeded(rpc);
        setSummary({
          id: result.id,
          doctorName: doctor.full_name,
          specialty: doctor.specialty ?? '',
          dateKey,
          time: slotTime,
        });
        setStep('success');
        setMsg(await notifyAppointment(sb, result.id, rescheduleId ? 'reschedule' : 'confirmation') || null);
      } catch {
        setMsg(MSG.failure);
      }
    });
  }

  const stepDots = ['doctor', 'date', 'time', 'review'] as const;

  if (doctorQuery.loading || doctorQuery.error) return <QueryState query={doctorQuery} label="doctors" />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{rescheduleId ? 'Reschedule Appointment' : 'Book an Appointment'}</h1>
        <p className="text-sm text-slate-400">
          Select a doctor, choose an available date and time, and confirm your appointment.
        </p>
      </div>

      {step !== 'success' && (
        <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Booking progress">
          {stepDots.map((s, i) => {
            const active = step === s;
            const done = stepDots.indexOf(step) > i;
            return (
              <li key={s} className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                    active ? 'bg-[#0e4a3a] text-white' : done ? 'bg-[#4ea895]/30 text-[#9fd8cb]' : 'bg-white/5 text-slate-500'
                  }`}
                >
                  {i + 1}
                </span>
                <span className={active ? 'font-semibold text-slate-200' : 'text-slate-500'}>
                  {s === 'doctor' ? 'Doctor' : s === 'date' ? 'Date' : s === 'time' ? 'Time' : 'Review'}
                </span>
                {i < stepDots.length - 1 && <AppIcon icon={ChevronRight} size={16} className="text-slate-600" />}
              </li>
            );
          })}
        </ol>
      )}

      <QueryState query={rescheduleQuery} label="appointment to reschedule" /><QueryState query={scheduleQuery} label="doctor schedule" /><QueryState query={datesQuery} label="appointment dates" />
      {(msg || queryError) && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{queryError || msg}</p>}

      {step === 'doctor' && (
        <section aria-labelledby="choose-doctor">
          <h2 id="choose-doctor" className="text-lg font-semibold">Choose a Doctor</h2>
          <p className="mb-3 text-sm text-slate-400">Select the doctor you would like to have your appointment with.</p>
          {doctors.length === 0 ? (
            <div className="dk-panel"><p className="py-4 text-center text-sm text-slate-500">No doctors available right now. Please check back later.</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {doctors.map((d) => (
                <article key={d.id} className="dk-panel space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0e4a3a]/25 text-sm font-bold text-[#9fd8cb]">
                      {initials(d.full_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">{d.full_name}</h3>
                      <p className="truncate text-xs text-slate-400">{d.specialty ?? 'General Medicine'}</p>
                      <p className="text-xs text-[#4ea895]">Available for appointments</p>
                    </div>
                  </div>
                  {expandedDoctor === d.id && (
                    <div className="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">
                      <p><span className="font-semibold">Specialty:</span> {d.specialty ?? 'General Medicine'}</p>
                      <p className="mt-1">Book an appointment with {d.full_name} by choosing a date below.</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="dk-btn-ghost flex-1"
                      onClick={() => setExpandedDoctor((v) => (v === d.id ? '' : d.id))}
                    >
                      {expandedDoctor === d.id ? 'Hide Profile' : 'View Profile'}
                    </button>
                    <button type="button" className="dk-btn-primary flex-1" onClick={() => pickDoctor(d.id)}>
                      Select Doctor
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {step === 'date' && doctor && (
        <section aria-labelledby="choose-date" className="space-y-3">
          <div className="dk-panel">
            <p className="text-xs text-slate-500">Booking an appointment with</p>
            <h2 id="choose-date" className="text-lg font-semibold">Book an Appointment with {doctor.full_name}</h2>
            <p className="text-sm text-slate-400">{doctor.specialty ?? 'General Medicine'} · Available Appointment Days: {doctorDaysLine}</p>
            <button type="button" className="icon-button mt-2 text-xs text-[#4ea895] hover:underline" onClick={() => setStep('doctor')}>
              <AppIcon icon={ChevronLeft} size={16} />Change Doctor
            </button>
          </div>
          <h3 className="text-base font-semibold">Choose a Date</h3>
          <p className="text-sm text-slate-400">Select a date when {doctor.full_name} is available.</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {dateOptions.map(({ key, dow, available }) => {
              const selected = dateKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!available}
                  onClick={() => {
                    setDateKey(key);
                    setSlotIso('');
                    setSlotTime('');
                    setMsg(null);
                    setStep('time');
                  }}
                  title={available ? formatDateLong(key) : `${formatDateLong(key)} — not available`}
                  className={`rounded-lg border px-2 py-2 text-center ${
                    selected
                      ? 'border-[#4ea895] bg-[#0e4a3a] text-white'
                      : available
                        ? 'border-white/10 text-slate-200 hover:bg-white/5'
                        : 'cursor-not-allowed border-white/5 text-slate-600 line-through opacity-60'
                  }`}
                >
                  <span className="block text-[11px] uppercase">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]}</span>
                  <span className="block text-sm font-bold">{Number(key.slice(8))}</span>
                  <span className="block text-[11px]">{formatClinicDate(key, { month: 'short' })}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {step === 'time' && doctor && (
        <section aria-labelledby="choose-time" className="space-y-3">
          <div className="dk-panel">
            <p className="text-xs text-slate-500">Appointment with {doctor.full_name} · {formatDateLong(dateKey)}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" className="icon-button text-xs text-[#4ea895] hover:underline" onClick={() => setStep('doctor')}><AppIcon icon={ChevronLeft} size={16} />Change Doctor</button>
              <button type="button" className="icon-button text-xs text-[#4ea895] hover:underline" onClick={() => setStep('date')}><AppIcon icon={ChevronLeft} size={16} />Change Date</button>
            </div>
          </div>
          <h3 id="choose-time" className="text-base font-semibold">Choose an Available Time</h3>
          <p className="text-sm text-slate-400">{formatDateLong(dateKey)}</p>
          {availability.loading || availability.error ? <QueryState query={availability} label="available times" /> : slots.length === 0 ? (
            <div className="dk-panel text-center">
              <h4 className="font-semibold">No Available Times</h4>
              <p className="mt-1 text-sm text-slate-400">There are no available appointment times for this date. Please choose another date.</p>
              <button type="button" className="dk-btn-primary mt-3" onClick={() => setStep('date')}>Choose Another Date</button>
            </div>
          ) : availableSlots.length === 0 ? (
            <div className="dk-panel text-center">
              <h4 className="font-semibold">No Available Times</h4>
              <p className="mt-1 text-sm text-slate-400">All times for this date have been booked. Please choose another date.</p>
              <button type="button" className="dk-btn-primary mt-3" onClick={() => setStep('date')}>Choose Another Date</button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="Available times">
              {slots.map((s) => (
                <button
                  key={s.iso}
                  type="button"
                  disabled={s.taken}
                  onClick={() => {
                    setSlotIso(s.iso);
                    setSlotTime(s.time);
                    setMsg(null);
                    setStep('review');
                  }}
                  title={s.taken ? `${formatSlotTime(s.time)} — already booked` : formatSlotTime(s.time)}
                  className={`rounded-lg border px-2 py-2.5 text-sm tabular-nums ${
                    s.taken
                      ? 'cursor-not-allowed border-white/5 text-slate-600 line-through opacity-60'
                      : 'border-white/10 text-slate-200 hover:bg-white/5'
                  }`}
                >
                  {formatSlotTime(s.time)}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {step === 'review' && doctor && (
        <section aria-labelledby="review" className="space-y-3">
          <h2 id="review" className="text-lg font-semibold">Review Your Appointment</h2>
          <div className="dk-panel space-y-3">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">Doctor</dt>
                <dd className="font-semibold">{doctor.full_name}</dd>
                <dd className="text-sm text-slate-400">{doctor.specialty ?? 'General Medicine'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">Patient</dt>
                <dd className="font-semibold">{profile?.full_name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">Date</dt>
                <dd className="font-semibold">{formatDateShort(dateKey)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">Time</dt>
                <dd className="font-semibold">{formatSlotTime(slotTime)}</dd>
              </div>
            </dl>
            {reschedInfo && (
              <p className="text-xs text-slate-500">
                Currently: {formatDateShort(reschedInfo.scheduled_time)} at {formatTime(reschedInfo.scheduled_time)} ({patientStatusLabel(reschedInfo.status)})
              </p>
            )}
            <div>
              <label htmlFor="reason" className="mb-1 block text-xs font-medium text-slate-400">Reason for visit (optional)</label>
              <textarea
                id="reason"
                className="dk-input"
                rows={2}
                placeholder="Briefly describe your concern"
                value={reason}
                maxLength={2000}
                readOnly={!!rescheduleId}
                onChange={(e) => setReason(e.target.value)}
              />
              {rescheduleId && <p className="text-xs text-slate-400">Rescheduling changes doctor/time. The original reason is preserved.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="icon-button dk-btn-ghost" onClick={() => setStep('doctor')}><AppIcon icon={ChevronLeft} size={16} />Change Doctor</button>
              <button type="button" className="icon-button dk-btn-ghost" onClick={() => setStep('date')}><AppIcon icon={Calendar} size={16} />Change Date</button>
              <button type="button" className="icon-button dk-btn-ghost" onClick={() => setStep('time')}><AppIcon icon={Clock} size={16} />Change Time</button>
            </div>
            <button type="button" className="dk-btn-primary w-full py-2.5" disabled={busy} onClick={() => void confirmBooking()}>
              {busy ? 'Booking…' : rescheduleId ? 'Confirm Reschedule' : 'Confirm Appointment'}
            </button>
          </div>
        </section>
      )}

      {step === 'success' && summary && (
        <section aria-labelledby="success" className="dk-panel mx-auto max-w-lg space-y-3 text-center">
          <p className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15 text-2xl text-green-400"><AppIcon icon={CircleCheck} size={24} /></p>
          <h2 id="success" className="text-xl font-bold">
            {rescheduleId ? 'Appointment Rescheduled!' : 'Appointment Booked Successfully!'}
          </h2>
          <p className="text-sm text-slate-300">
            Your appointment with {summary.doctorName} has been scheduled successfully.
          </p>
          <dl className="space-y-1 rounded-lg bg-white/5 px-4 py-3 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Doctor:</dt><dd className="font-semibold">{summary.doctorName}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Date:</dt><dd className="font-semibold">{formatDateShort(summary.dateKey)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Time:</dt><dd className="font-semibold">{formatSlotTime(summary.time)}</dd></div>
          </dl>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className="dk-btn-primary flex-1" onClick={() => nav('/patient/appointments')}>
              View My Appointments
            </button>
            <Link to="/patient/dashboard" className="dk-btn-ghost flex-1 text-center">
              Back to Dashboard
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
