// PATIENT-ONLY client; storage remains isolated from staff.
import { createContext, useContext, type ReactNode } from 'react';
import { createAppClient } from '../../../lib/supabaseClient';
import { usePortalAuth } from '../../../lib/usePortalAuth';
const patientSupabase = createAppClient('medical-patient');
export const getPatientClient = () => patientSupabase;
type PatientAuthCtx = ReturnType<typeof usePortalAuth> & { refreshPatient: () => Promise<void> };
const Ctx = createContext<PatientAuthCtx | null>(null);
export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const auth = usePortalAuth(patientSupabase, 'patient');
  return <Ctx.Provider value={{ ...auth, refreshPatient: auth.refreshIdentity }}>{children}</Ctx.Provider>;
}
export function usePatientAuth(): PatientAuthCtx {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePatientAuth must be used inside PatientAuthProvider');
  return value;
}
