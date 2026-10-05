let revision = 0;
const listeners = new Set<() => void>();
export const appointmentRevision = () => revision;
export function subscribeAppointmentChanges(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function invalidateAppointments() { revision++; for (const listener of listeners) listener(); }
/** Only successful persisted mutations invalidate all affected views. */
export function appointmentMutationSucceeded(result: { error: unknown; data: unknown }): boolean {
  if (result.error || !(result.data as { success?: boolean } | null)?.success) return false;
  invalidateAppointments();
  return true;
}
