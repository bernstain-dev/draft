export const CLINIC_TIME_ZONE = 'Asia/Manila';
const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
export function clinicDateKey(value: Date | string = new Date()): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    validateDateKey(value);
    return value;
  }
  const d = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) throw new Error('Invalid appointment timestamp.');
  const parts = Object.fromEntries(dateParts.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function validateDateKey(key: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Select a valid clinic date.');
  const d = new Date(`${key}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== key) throw new Error('Select a valid clinic date.');
}
export function clinicInstant(key: string, time = '00:00'): string {
  validateDateKey(key);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Select a valid whole-minute clinic time.');
  return new Date(`${key}T${time}:00+08:00`).toISOString();
}
export function addClinicDays(key: string, days: number): string {
  validateDateKey(key);
  if (!Number.isInteger(days)) throw new Error('Day offset must be an integer.');
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function clinicWeekday(key: string): number {
  validateDateKey(key);
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}
export function clinicWeekDates(key = clinicDateKey()): string[] {
  const first = addClinicDays(key, -clinicWeekday(key));
  return Array.from({ length: 7 }, (_, day) => addClinicDays(first, day));
}
export function clinicDayRange(key: string) {
  const startIso = clinicInstant(key);
  const nextStartIso = clinicInstant(addClinicDays(key, 1));
  return { startIso, nextStartIso, endIso: new Date(Date.parse(nextStartIso) - 1).toISOString() };
}
export function clinicMonthRange(key: string) {
  validateDateKey(key);
  const [year, oneBasedMonth] = key.split('-').map(Number);
  const first = `${key.slice(0, 7)}-01`;
  const next = new Date(Date.UTC(year, oneBasedMonth, 1)).toISOString().slice(0, 10);
  return { startIso: clinicInstant(first), nextStartIso: clinicInstant(next),
    year, month: oneBasedMonth - 1, daysInMonth: Number(addClinicDays(next, -1).slice(8)) };
}
function displayInstant(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? clinicInstant(value, '12:00') : value);
}
export function formatClinicDate(value: string, options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }): string {
  return new Intl.DateTimeFormat('en-PH', { ...options, timeZone: CLINIC_TIME_ZONE }).format(displayInstant(value));
}
export function formatClinicTime(value: string): string {
  return new Intl.DateTimeFormat('en-PH', { hour: '2-digit', minute: '2-digit', timeZone: CLINIC_TIME_ZONE }).format(displayInstant(value));
}
export function clinicTimeKey(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: CLINIC_TIME_ZONE }).format(displayInstant(value));
}
export function formatClinicDateTime(value: string): string {
  return `${formatClinicDate(value)} ${formatClinicTime(value)}`;
}
