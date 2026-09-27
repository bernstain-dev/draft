// Pure slot computation — no auth, safe to share between staff and patient pages.
import type { Appointment, DoctorSchedule, DoctorUnavailable } from './types';

export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Shared day-range helper (Bug 3/4 fix): Dashboard and Check-in must filter
 *  the same way. Interprets dateKey as a LOCAL calendar day and returns the
 *  UTC ISO bounds covering it, so browser-local vs timestamptz(UTC) never
 *  drifts between pages. */
export function dayRangeIso(dateKey: string): { startIso: string; endIso: string } {
  return {
    startIso: new Date(`${dateKey}T00:00:00`).toISOString(),
    endIso: new Date(`${dateKey}T23:59:59.999`).toISOString(),
  };
}

export function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Generate slot start-times (local) for a doctor on a given date. */
export function generateSlots(
  dateKey: string,
  schedules: DoctorSchedule[],
  unavailable: DoctorUnavailable[],
  booked: Appointment[],
  dayOfWeek: number
): { time: string; iso: string; taken: boolean }[] {
  if (unavailable.some((u) => u.date === dateKey)) return [];
  const daySched = schedules.filter((s) => s.day_of_week === dayOfWeek);
  if (daySched.length === 0) return [];
  const takenSet = new Set(
    booked
      .filter((a) => !['cancelled', 'no_show'].includes(a.status))
      .map((a) => new Date(a.scheduled_time).toTimeString().slice(0, 5))
  );
  const out: { time: string; iso: string; taken: boolean }[] = [];
  for (const s of daySched) {
    const start = parseTimeToMinutes(s.start_time.slice(0, 5));
    const end = parseTimeToMinutes(s.end_time.slice(0, 5));
    const step = s.slot_duration_minutes || 30;
    for (let m = start; m + step <= end; m += step) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const time = `${hh}:${mm}`;
      out.push({
        time,
        iso: new Date(`${dateKey}T${time}:00`).toISOString(),
        taken: takenSet.has(time),
      });
    }
  }
  return out.sort((a, b) => (a.time < b.time ? -1 : 1));
}
