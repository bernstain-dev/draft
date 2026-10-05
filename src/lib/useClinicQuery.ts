import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RequestGeneration } from './asyncState.ts';
import { appointmentRevision, subscribeAppointmentChanges } from './appointmentChanges.ts';
export function useAppointmentRevision() { return useSyncExternalStore(subscribeAppointmentChanges, appointmentRevision, appointmentRevision); }
export function useClinicQuery<T>(key: string, load: (signal: AbortSignal) => PromiseLike<T>, initial: T, timeoutMs = 30000) {
  const [retrySerial, setRetrySerial] = useState(0);
  const requestKey = `${key}:${retrySerial}`;
  const gate = useRef(new RequestGeneration());
  const loader = useRef(load); loader.current = load;
  const [result, setResult] = useState<{ key: string; data: T; loading: boolean; error: string | null }>({ key: '', data: initial, loading: false, error: null });
  useEffect(() => {
    const ticket = gate.current.next();
    setResult({ key: requestKey, data: initial, loading: !!key, error: null });
    const deadline = key ? setTimeout(() => {
      if (!ticket.isCurrent()) return;
      gate.current.cancel();
      setResult({ key: requestKey, data: initial, loading: false, error: 'The request timed out. Please retry.' });
    }, timeoutMs) : null;
    if (key) Promise.resolve().then(() => loader.current(ticket.signal)).then((data) => {
      if (ticket.isCurrent()) setResult({ key: requestKey, data, loading: false, error: null });
    }).catch((err) => {
      if (ticket.isCurrent()) setResult({ key: requestKey, data: initial, loading: false, error: (err instanceof Error && err.message) || 'Unable to load clinic data.' });
    }).finally(() => { if (deadline) clearTimeout(deadline); });
    return () => { if (deadline) clearTimeout(deadline); gate.current.cancel(); };
    // Load identity is explicitly represented by key; never use unstable callbacks as dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retrySerial]);
  const current = result.key === requestKey ? result : { key, data: initial, loading: !!key, error: null };
  return { ...current, retry: () => setRetrySerial(s => s + 1), retrying: current.loading && retrySerial > 0 };
}
