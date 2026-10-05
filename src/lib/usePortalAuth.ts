import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Patient, Profile } from './types.ts';
import { IdentityCoordinator, RequestGeneration, type IdentityState } from './asyncState.ts';
import { textError } from './formValidation.ts';
import { resolvePortalIdentity } from './portalIdentity.ts';

export function usePortalAuth(client: SupabaseClient, portal: 'patient' | 'admin', timeoutMs = 30000) {
  const [state, setState] = useState<IdentityState<User, Profile, Patient>>({ user: null, profile: null, patient: null, loading: true, error: null });
  const coordinator = useRef<IdentityCoordinator<User, Profile, Patient> | null>(null);
  const actions = useRef(new RequestGeneration());
  useEffect(() => {
    const identity = new IdentityCoordinator<User, Profile, Patient>((user, signal) => resolvePortalIdentity(client, portal, user, signal), setState, timeoutMs);
    coordinator.current = identity;
    setState(identity.state);
    let receivedAuthEvent = false;
    const deadline = setTimeout(() => {
      if (!receivedAuthEvent) { receivedAuthEvent = true; identity.fail('Session initialization timed out. Please retry.'); }
    }, timeoutMs);
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      receivedAuthEvent = true;
      clearTimeout(deadline);
      // Synchronous callback; coordinator defers network queries outside the auth lock.
      void identity.accept(session?.user ?? null);
    });
    client.auth.getSession().then(({ data, error }) => {
      clearTimeout(deadline);
      if (receivedAuthEvent) return;
      if (error) identity.fail(error.message);
      else void identity.accept(data.session?.user ?? null);
    }).catch((err) => { clearTimeout(deadline); if (!receivedAuthEvent) identity.fail(err instanceof Error ? err.message : 'Unable to initialize your session.'); });
    return () => { clearTimeout(deadline); actions.current.cancel(); sub.subscription.unsubscribe(); identity.dispose(); if (coordinator.current === identity) coordinator.current = null; };
  }, [client, portal, timeoutMs]);

  async function signIn(email: string, password: string): Promise<string | null> {
    const identity = coordinator.current;
    if (!identity) return 'Session initialization is not ready. Please retry.';
    const action = actions.current.next();
    void identity.accept(null);
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (!action.isCurrent()) return 'Your session changed. Please try again.';
      if (error) { identity.fail(error.message); return error.message; }
      if (!data.user) { identity.fail('Login failed.'); return 'Login failed.'; }
      return await identity.accept(data.user);
    } catch (err) {
      if (!action.isCurrent()) return 'Your session changed. Please try again.';
      const message = err instanceof Error ? err.message : 'Login failed.';
      identity.fail(message); return message;
    }
  }
  async function signUp(fullName: string, email: string, password: string): Promise<string | null> {
    const identity = coordinator.current;
    if (!identity || portal !== 'patient') return 'Patient signup is unavailable.';
    const name = fullName.trim();
    const validation = textError(name, 'Full name', 300, true);
    if (validation) return validation;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return 'Enter a valid email address.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    const action = actions.current.next();
    void identity.accept(null);
    try {
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: name } } });
      if (!action.isCurrent()) return 'Your session changed. Please try again.';
      if (error) { identity.fail(error.message); return error.message; }
      if (!data.user) return 'Signup failed. Please try again.';
      if (!data.session) return 'Account created! Check your email to confirm, then sign in.';
      // Profile + patient provisioning happens atomically in the database.
      // A failed RPC/link is returned to the caller, never reported as success.
      return await identity.accept(data.user);
    } catch (err) {
      if (!action.isCurrent()) return 'Your session changed. Please try again.';
      const message = err instanceof Error ? err.message : 'Unable to complete your patient account.';
      identity.fail(message); return message;
    }
  }
  async function signOut() {
    const identity = coordinator.current;
    const action = actions.current.next();
    void identity?.accept(null);
    // Keep portal storage keys and avoid global logout invalidating the other portal.
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error && action.isCurrent()) identity?.fail(error.message);
    } catch (err) { if (action.isCurrent()) identity?.fail(err instanceof Error ? err.message : 'Unable to sign out.'); }
  }
  async function refreshIdentity() {
    const identity = coordinator.current;
    if (!identity) return;
    if (identity.state.user) { await identity.accept(identity.state.user, true); return; }
    const action = actions.current.next();
    try {
      const { data, error } = await client.auth.getSession();
      if (!action.isCurrent()) return;
      if (error) identity.fail(error.message);
      else await identity.accept(data.session?.user ?? null, true);
    } catch (err) { if (action.isCurrent()) identity.fail(err instanceof Error ? err.message : 'Unable to load your session.'); }
  }
  return { ...state, signIn, signUp, signOut, refreshIdentity };
}
