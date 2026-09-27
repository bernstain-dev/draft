// Shared factory only — NOT a shared session.
// Each route group creates its OWN client with its OWN storageKey so
// staff (/appointments) and patient (/patient) sessions never mix.
// Auth logic itself lives separately in:
//   src/pages/appointments/auth/*  (staff only)
//   src/pages/patient/auth/*       (patient only)
// Neither folder may import from the other.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function createAppClient(storageKey: string): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env). See .env.example.');
  }
  return createClient(url, anonKey, {
    auth: {
      storageKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export type StaffRole = 'admin';
