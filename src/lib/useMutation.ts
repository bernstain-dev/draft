import { useEffect, useRef, useState } from 'react';
export function useMutation(onError: (message: string) => void) {
  const locked = useRef(false), mounted = useRef(true);
  const [pending, setPending] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (locked.current) return;
    locked.current = true; if (mounted.current) setPending(true);
    try { return await operation(); }
    catch (error) { if (mounted.current) onError(error instanceof Error ? error.message : 'Operation failed. Please retry.'); }
    finally { locked.current = false; if (mounted.current) setPending(false); }
  }
  return { pending, run };
}
