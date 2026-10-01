// PATIENT-ONLY auth. Do not import anything from ../../appointments.
// Separate Supabase client + storage key so the staff session can never
// leak in here.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createAppClient } from '../../../lib/supabaseClient';
import type { Patient, Profile } from '../../../lib/types';

const patientSupabase: SupabaseClient = createAppClient('medical-patient');

export function getPatientClient(): SupabaseClient {
  return patientSupabase;
}

interface PatientAuthCtx {
  user: User | null;
  profile: Profile | null;
  /** The patient's own row in `patients` (null until resolved). */
  patient: Patient | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (fullName: string, email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshPatient: () => Promise<void>;
}

const Ctx = createContext<PatientAuthCtx | null>(null);

async function loadProfile(uid: string): Promise<Profile | null> {
  const { data } = await patientSupabase.from('profiles').select('*').eq('id', uid).single();
  return (data as Profile | null) ?? null;
}

/**
 * Resolve the logged-in user's row in `patients`.
 * Works both after the patient-booking migration (patients.user_id) and
 * on older databases (falls back to a full_name match, then creates a row).
 */
async function resolvePatient(uid: string, fullName: string): Promise<Patient | null> {
  // 1) Preferred: direct auth link (post-migration schema).
  try {
    const { data, error } = await patientSupabase
      .from('patients')
      .select('*')
      .eq('user_id', uid)
      .limit(1)
      .maybeSingle();
    if (!error && data) return data as Patient;
  } catch {
    // column may not exist yet — fall through to legacy lookup
  }

  // 2) Legacy: match by name (pre-migration databases).
  const { data: byName } = await patientSupabase
    .from('patients')
    .select('*')
    .eq('full_name', fullName)
    .limit(1)
    .maybeSingle();
  if (byName) {
    const row = byName as Patient;
    // Opportunistically attach the auth link when the column exists.
    try {
      await patientSupabase.from('patients').update({ user_id: uid }).eq('id', row.id);
      return { ...row, user_id: uid };
    } catch {
      return row;
    }
  }

  // 3) First visit: create the patient record.
  try {
    const { data, error } = await patientSupabase
      .from('patients')
      .insert({ full_name: fullName, user_id: uid })
      .select('*')
      .single();
    if (!error && data) return data as Patient;
  } catch {
    // user_id column missing — insert without it
  }
  const { data: legacy } = await patientSupabase
    .from('patients')
    .insert({ full_name: fullName })
    .select('*')
    .single();
  return (legacy as Patient | null) ?? null;
}

export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAll(u: User | null) {
    if (!u) {
      setProfile(null);
      setPatient(null);
      return;
    }
    const prof = await loadProfile(u.id);
    setProfile(prof);
    if (prof) {
      try {
        setPatient(await resolvePatient(u.id, prof.full_name));
      } catch {
        setPatient(null);
      }
    }
  }

  useEffect(() => {
    patientSupabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u);
      await loadAll(u);
      setLoading(false);
    });
    const { data: sub } = patientSupabase.auth.onAuthStateChange(async (_e, session) => {
      const u = session?.user ?? null;
      setUser(u);
      await loadAll(u);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(email: string, password: string): Promise<string | null> {
    const { data, error } = await patientSupabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    const uid = data.user?.id;
    if (!uid) return 'Login failed.';
    let prof = await loadProfile(uid);
    if (!prof) {
      // Self-heal: account was created while email confirmation was ON,
      // so the profile row does not exist yet. Create it now that a
      // session exists (allowed by the profiles_insert_own policy).
      const meta = data.user?.user_metadata as { full_name?: unknown } | undefined;
      const metaName =
        (typeof meta?.full_name === 'string' ? meta.full_name.trim() : '') || email.split('@')[0];
      const { error: mkErr } = await patientSupabase
        .from('profiles')
        .insert({ id: uid, full_name: metaName, role: 'patient' });
      if (mkErr) return 'Your account is not set up yet. Please contact the administrator.';
      prof = { id: uid, full_name: metaName, role: 'patient' };
    }
    if (prof.role !== 'patient') {
      await patientSupabase.auth.signOut();
      setUser(null);
      setProfile(null);
      setPatient(null);
      return 'This account is not a patient account. Staff must use /appointments/login.';
    }
    setUser(data.user);
    setProfile(prof);
    try {
      setPatient(await resolvePatient(uid, prof.full_name));
    } catch {
      setPatient(null);
    }
    return null;
  }

  async function signUp(fullName: string, email: string, password: string): Promise<string | null> {
    const name = fullName.trim();
    if (!name) return 'Please enter your full name.';
    const { data, error } = await patientSupabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (error) return error.message;
    const u = data.user;
    if (!u) return 'Signup failed. Please try again.';
    if (!data.session) {
      // Email confirmation is ON in the Supabase project: there is no
      // session yet, so the profile row cannot be inserted now (RLS
      // needs auth.uid()). It is created on first sign-in (see signIn).
      return 'Account created! Check your email to confirm, then sign in.';
    }
    // Self-insert of the patient profile (allowed by profiles_insert_own policy).
    const { error: profErr } = await patientSupabase
      .from('profiles')
      .insert({ id: u.id, full_name: name, role: 'patient' });
    if (profErr) return profErr.message;
    const prof: Profile = { id: u.id, full_name: name, role: 'patient' };
    setUser(u);
    setProfile(prof);
    try {
      setPatient(await resolvePatient(u.id, name));
    } catch {
      setPatient(null);
    }
    return null;
  }

  async function signOut() {
    await patientSupabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setPatient(null);
  }

  async function refreshPatient() {
    if (user && profile) {
      try {
        setPatient(await resolvePatient(user.id, profile.full_name));
      } catch {
        // keep existing
      }
    }
  }

  return (
    <Ctx.Provider value={{ user, profile, patient, loading, signIn, signUp, signOut, refreshPatient }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePatientAuth(): PatientAuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePatientAuth must be used inside PatientAuthProvider');
  return v;
}
