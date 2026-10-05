// STAFF-ONLY client; storage remains isolated from patients.
import { createContext, useContext, type ReactNode } from 'react';
import { createAppClient, type StaffRole } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
import { useAppointmentRealtime } from '../../../lib/useAppointmentRealtime';
const staffSupabase = createAppClient('medical-appointments-staff');
export const getStaffClient = () => staffSupabase;
type StaffAuthCtx = ReturnType<typeof usePortalAuth> & { role: StaffRole | null };
const Ctx = createContext<StaffAuthCtx | null>(null);
export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const auth = usePortalAuth(staffSupabase, 'admin');
  const role: StaffRole | null = auth.profile?.role === 'admin' ? 'admin' : null;
  useAppointmentRealtime(staffSupabase, auth.user?.id ?? null, role);
  return <Ctx.Provider value={{ ...auth, role }}>{children}</Ctx.Provider>;
}
export function useStaffAuth(): StaffAuthCtx {
  const value = useContext(Ctx);
  if (!value) throw new Error('useStaffAuth must be used inside StaffAuthProvider');
  return value;
}
