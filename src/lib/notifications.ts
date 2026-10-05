import type { SupabaseClient } from '@supabase/supabase-js';
export async function notifyAppointment(client: SupabaseClient, id: string, type: 'confirmation' | 'reschedule' | 'cancellation'): Promise<string> {
  if (import.meta.env.VITE_NOTIFY_ENABLED !== 'true') return '';
  try {
    const { data, error } = await client.functions.invoke('send-confirmation', { body: { appointment_id: id, type } });
    if (error) return ' Appointment saved; notification could not be checked. The server queue retains its attempt.';
    if (data?.error === 'result_persistence_failed') return ' Provider result could not be recorded; delivery is unverified.';
    if (data?.delivery === 'delivered') return ' Provider reports notification delivery.';
    if (data?.delivery === 'failed') return ' Provider reports notification delivery failure; the appointment change remains saved.';
    if (data?.accepted === true) return ' Notification accepted by provider; delivery is not yet verified.';
    if (data?.stubbed === true) return ' Notification not sent: provider or contact is unavailable.';
    if (data?.status === 'processing') return ' Notification is being processed; delivery is unverified.';
    return ' Notification was not accepted; the appointment change remains saved.';
  } catch { return ' Notification unavailable; the appointment change remains saved.'; }
}
