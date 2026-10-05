import { constantTimeEqual } from './http.ts';
import type { Env } from './notify.ts';
// Twilio signs the exact configured URL plus all sorted form parameters.
export async function callbackSignature(url: string, params: URLSearchParams, token: string): Promise<string> {
  const message = url + [...params.keys()].sort().map(key => key + params.get(key)).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return btoa(String.fromCharCode(...bytes));
}
export function deliveryHandler(env: Env, service: () => { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }) {
  return async (req: Request) => {
    const respond = (ok: boolean, status: number) => new Response(JSON.stringify({ ok }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (req.method !== 'POST') return respond(false, 405);
    const url = env('NOTIFY_STATUS_CALLBACK_URL'), token = env('TWILIO_AUTH_TOKEN');
    if (!url || !token) return respond(false, 503);
    try {
      if (req.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return respond(false, 400);
      const rawBody = await req.text(); if (rawBody.length > 16384) return respond(false, 413);
      const params = new URLSearchParams(rawBody);
      if (new Set(params.keys()).size !== [...params.keys()].length) return respond(false, 400);
      const expected = await callbackSignature(url, params, token);
      if (!constantTimeEqual(expected, req.headers.get('x-twilio-signature') ?? '')) return respond(false, 403);
      const sid = params.get('MessageSid'); if (!sid || !/^SM[0-9a-f]{32}$/i.test(sid)) return respond(false, 400);
      const raw = params.get('MessageStatus');
      const status = ['failed','undelivered','canceled'].includes(raw ?? '') ? 'failed' : raw === 'delivered' ? 'delivered' : raw === 'sent' ? 'sent' : ['queued','accepted','sending'].includes(raw ?? '') ? 'queued' : null;
      if (!status) return respond(false, 400);
      const result = await service().rpc('record_notification_delivery', { p_reference: sid, p_status: status });
      // A callback arriving before result persistence is retriable, not lost as success.
      if (result.error || result.data !== true) return respond(false, 503);
      return respond(true, 200);
    } catch { return respond(false, 503); }
  };
}
