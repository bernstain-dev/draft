export function scheduleInputError(input: { day_of_week: number; start_time: string; end_time: string; slot_duration_minutes: number }): string | null {
  const minutes = (time: string) => {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
    const [h, m] = time.split(':').map(Number); return h * 60 + m;
  };
  const start = minutes(input.start_time), end = minutes(input.end_time);
  if (!Number.isInteger(input.day_of_week) || input.day_of_week < 0 || input.day_of_week > 6) return 'Choose a valid weekday.';
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return 'Enter whole-minute working hours with start before end.';
  if (!Number.isInteger(input.slot_duration_minutes) || input.slot_duration_minutes < 1
    || input.slot_duration_minutes > 1440 || input.slot_duration_minutes > end - start) return 'Slot duration must be a positive whole number of minutes that fits within working hours.';
  return null;
}
export function scheduleBackendError(error: { code?: string; message: string }): string {
  if (error.code === '23P01' || error.code === '23505') return 'These working hours duplicate or overlap an existing schedule for this doctor and weekday.';
  if (error.code === '23514') return 'Use whole-minute working hours, start before end, and a positive slot duration that fits the schedule.';
  return error.message;
}
