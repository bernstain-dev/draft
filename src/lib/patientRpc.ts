// Patient RPC helpers.
import type { PostgrestError } from '@supabase/supabase-js';

/** True when an RPC call failed only because the function isn't deployed yet. */
export function isMissingRpc(err: unknown): boolean {
  const e = err as PostgrestError & { code?: string; message?: string } | null;
  if (!e) return false;
  const msg = `${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`.toLowerCase();
  return (
    e.code === 'PGRST202' ||
    (e as { code?: string }).code === '42883' ||
    msg.includes('does not exist') ||
    msg.includes('not found') ||
    msg.includes('could not find the function')
  );
}
