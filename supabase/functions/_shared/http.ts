import type { Env } from './notify.ts';
export function cors(req: Request, env: Env): { headers: Headers; denied: boolean } {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Vary': 'Origin', 'Cache-Control': 'no-store' });
  const origin = req.headers.get('Origin');
  const allowed = (env('NOTIFY_ALLOWED_ORIGINS') ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const denied = !!origin && !allowed.includes(origin);
  if (origin && !denied) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return { headers, denied };
}
export function json(headers: Headers, data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers }); }
export const validUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function constantTimeEqual(left: string, right: string): boolean {
  let different = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) different |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return different === 0;
}
