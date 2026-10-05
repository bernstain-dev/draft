import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { clinicTimeKey, clinicDateKey } from './clinicTime.ts';
import { useAppointmentRevision, useClinicQuery } from './useClinicQuery.ts';
export interface AvailableSlot { iso: string; time: string; taken: false; duration: number }
export function useAvailability(client: SupabaseClient, doctorId: string, dateKey: string) {
  const revision = useAppointmentRevision();
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    const timer = setInterval(() => setMinute(Math.floor(Date.now() / 60000)), 15000);
    return () => clearInterval(timer);
  }, []);
  return useClinicQuery<AvailableSlot[]>(doctorId && dateKey ? `${doctorId}/${dateKey}/${revision}/${dateKey === clinicDateKey() ? minute : ''}` : '', async (signal) => {
    const { data, error } = await client.rpc('get_available_appointment_slots', { p_doctor_id: doctorId, p_date: dateKey }).abortSignal(signal);
    if (error) throw new Error(error.message);
    return (data as { scheduled_time: string; slot_duration_minutes: number }[] ?? []).map((s) => ({
      iso: s.scheduled_time, time: clinicTimeKey(s.scheduled_time), taken: false, duration: s.slot_duration_minutes,
    }));
  }, []);
}
