import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Patient, Profile } from './types.ts';
export async function resolvePortalIdentity(client: SupabaseClient, portal: 'patient' | 'admin', user: User, signal: AbortSignal) {
  if (portal === 'patient') {
    const meta = user.user_metadata?.full_name;
    const name = (typeof meta === 'string' ? meta.trim() : '') || user.email?.split('@')[0] || '';
    const { data, error } = await client.rpc('ensure_patient_identity', { p_full_name: name }).abortSignal(signal);
    if (error) throw new Error(error.message);
    const identity = data as { profile?: Profile; patient?: Patient } | null;
    if (!identity?.profile || !identity.patient || identity.profile.id !== user.id || identity.profile.role !== 'patient'
      || identity.patient.user_id !== user.id || !identity.patient.id) throw new Error('Patient identity could not be verified. Contact the clinic.');
    return { profile: identity.profile, patient: identity.patient };
  }
  const { data, error } = await client.from('profiles').select('*').eq('id', user.id).abortSignal(signal).maybeSingle();
  if (error) throw new Error(error.message);
  const profile = data as Profile | null;
  if (!profile) throw new Error('Your staff profile is missing. Contact the administrator.');
  if (profile.id !== user.id || profile.role !== 'admin') throw new Error('This account is not an admin account. Patients must use /patient/login.');
  return { profile, patient: null };
}
