// STAFF-ONLY auth (admin role only — logins are admin + patient).
// Do not import anything from ../../patient.
// Separate Supabase client + storage key so the
// patient session can never leak in here.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createAppClient, type StaffRole } from '../../../lib/supabaseClient';
import type { Profile } from '../../../lib/types';

const staffSupabase: SupabaseClient = createAppClient('medical-appointments-staff');

export function getStaffClient(): SupabaseClient {
  return staffSupabase;
}

interface StaffAuthCtx {
  user: User | null;
  profile: Profile | null;
  role: StaffRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<StaffAuthCtx | null>(null);

export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(uid: string): Promise<Profile | null> {
    const { data } = await staffSupabase.from('profiles').select('*').eq('id', uid).single();
    return (data as Profile | null) ?? null;
  }

  useEffect(() => {
    staffSupabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u);
      setProfile(u ? await loadProfile(u.id) : null);
      setLoading(false);
    });
    const { data: sub } = staffSupabase.auth.onAuthStateChange(async (_e, session) => {
      const u = session?.user ?? null;
      setUser(u);
      setProfile(u ? await loadProfile(u.id) : null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string): Promise<string | null> {
    const { data, error } = await staffSupabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    const uid = data.user?.id;
    if (!uid) return 'Login failed.';
    const prof = await loadProfile(uid);
    if (!prof || prof.role !== 'admin') {
      await staffSupabase.auth.signOut();
      setUser(null);
      setProfile(null);
      return 'This account is not an admin account. Patients must use /patient/login.';
    }
    setUser(data.user);
    setProfile(prof);
    return null;
  }

  async function signOut() {
    await staffSupabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }

  const role = (profile?.role as StaffRole | undefined) ?? null;
  return (
    <Ctx.Provider value={{ user, profile, role, loading, signIn, signOut }}>{children}</Ctx.Provider>
  );
}

export function useStaffAuth(): StaffAuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStaffAuth must be used inside StaffAuthProvider');
  return v;
}
