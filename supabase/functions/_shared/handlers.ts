import { sendNotification, type Env } from './notify.ts';
import { cors, json, validUuid, constantTimeEqual } from './http.ts';
interface Client {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
}
export interface Dependencies { env: Env; userClient: (authorization: string) => Client; serviceClient: () => Client; network?: typeof fetch }
interface Claim { event_id: string; lease_token: string; notification_type: string; scheduled_time: string; contact_number: string | null }
export function noticeText(type: string, instant: string): string {
  const when = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
  const action = type === 'cancellation' ? 'cancelled' : type === 'reschedule' ? 'rescheduled' : type === 'reminder' ? 'a reminder for' : 'confirmed';
  return `RHU appointment: ${action} ${when} (Philippine time). Contact the clinic for assistance.`;
}
async function dispatch(client: Client, claims: Claim[], deps: Dependencies) {
  const results = [];
  for (const claim of claims) {
    const result = await sendNotification(claim.contact_number, noticeText(claim.notification_type, claim.scheduled_time), deps.env, deps.network);
    const saved = await client.rpc('finish_appointment_notification', { p_event_id: claim.event_id, p_lease_token: claim.lease_token,
      p_status: result.status, p_provider: result.provider, p_reference: result.reference, p_error: result.error, p_retry: result.retry });
    if (saved.error || saved.data !== true) results.push({ ok: false, accepted: result.accepted, stubbed: result.stubbed, provider: result.provider, error: 'result_persistence_failed', delivery: 'not_verified' });
    else results.push({ ok: result.ok, accepted: result.accepted, stubbed: result.stubbed, provider: result.provider, error: result.error, delivery: result.delivery });
  }
  return results;
}
export function confirmationHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    const { headers, denied } = cors(req, deps.env);
    const reply = (data: unknown, status = 200) => json(headers, data, status);
    if (denied) return reply({ ok: false, error: 'origin_not_allowed' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply({ ok: false, error: 'POST_required' }, 405);
    try {
      const authorization = req.headers.get('Authorization') ?? '';
      if (!/^Bearer\s+\S+$/i.test(authorization)) return reply({ ok: false, error: 'authentication_required' }, 401);
      const userClient = deps.userClient(authorization);
      const auth = await userClient.auth.getUser();
      if (auth.error || !auth.data.user) return reply({ ok: false, error: 'invalid_session' }, 401);
      let body;
      try { const raw = await req.text(); if (raw.length > 4096) return reply({ ok: false, error: 'payload_too_large' }, 413); body = JSON.parse(raw); } catch { return reply({ ok: false, error: 'invalid_JSON' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !validUuid(body.appointment_id)) return reply({ ok: false, error: 'valid_appointment_id_required' }, 400);
      const type = body.type ?? 'confirmation';
      if (!['confirmation', 'reschedule', 'cancellation'].includes(type)) return reply({ ok: false, error: 'invalid_notification_type' }, 400);
      const event = await userClient.rpc('request_appointment_notification', { p_appointment_id: body.appointment_id, p_type: type });
      if (event.error) return reply({ ok: false, error: event.error.code === '42501' ? 'not_authorized' : 'notification_request_failed' }, event.error.code === '42501' ? 403 : 503);
      if (!event.data) return reply({ ok: false, executed: true, accepted: false, stubbed: false, error: 'no_current_notification' });
      const service = deps.serviceClient();
      const claim = await service.rpc('claim_appointment_notifications', { p_event_id: event.data, p_limit: 1 });
      if (claim.error) return reply({ ok: false, error: 'notification_claim_failed' }, 503);
      if ((claim.data ?? []).length) { const results = await dispatch(service, claim.data, deps); return reply({ executed: true, ...results[0] }); }
      const existing = await service.rpc('notification_result', { p_event_id: event.data });
      if (existing.error || !existing.data) return reply({ ok: false, error: 'notification_status_failed' }, 503);
      return reply({ executed: true, duplicate: true, ok: existing.data.accepted === true, ...existing.data });
    } catch { return reply({ ok: false, error: 'notification_unavailable' }, 503); }
  };
}
export function reminderHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    const { headers, denied } = cors(req, deps.env);
    const reply = (data: unknown, status = 200) => json(headers, data, status);
    if (denied) return reply({ ok: false, error: 'origin_not_allowed' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply({ ok: false, error: 'POST_required' }, 405);
    const secret = deps.env('CRON_SECRET');
    if (!secret || !constantTimeEqual(req.headers.get('x-cron-secret') ?? '', secret)) return reply({ ok: false, error: 'cron_authentication_required' }, 401);
    try {
      const service = deps.serviceClient();
      const queued = await service.rpc('queue_due_appointment_reminders');
      if (queued.error) return reply({ ok: false, error: 'reminder_queue_failed' }, 503);
      const claims = await service.rpc('claim_appointment_notifications', { p_limit: 5 });
      if (claims.error) return reply({ ok: false, error: 'notification_claim_failed' }, 503);
      const results = await dispatch(service, claims.data ?? [], deps);
      return reply({ executed: true, ok: results.every(r => r.ok), queued: queued.data,
        processed: results.length, accepted: results.filter(r => r.accepted).length,
        stubbed: results.filter(r => r.stubbed).length, failed: results.filter(r => !r.ok && !r.stubbed).length, delivery: 'not_verified' });
    } catch { return reply({ ok: false, error: 'reminder_unavailable' }, 503); }
  };
}
