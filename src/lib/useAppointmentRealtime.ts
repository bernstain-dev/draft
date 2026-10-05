import { useEffect } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invalidateAppointments } from './appointmentChanges';
// One staff-provider subscription. No patient global feed. RLS remains authority.
export function useAppointmentRealtime(client: SupabaseClient, userId: string | null, role: string | null) {
  useEffect(() => {
    if (!userId || role !== 'admin') return;
    let active = true, timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (!active || timer) return; timer = setTimeout(() => { timer = null; if (active) invalidateAppointments(); }, 300); };
    const channel = client.channel(`staff-appointments-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, refresh).subscribe();
    return () => { active = false; if (timer) clearTimeout(timer); void client.removeChannel(channel); };
  }, [client, userId, role]);
}
