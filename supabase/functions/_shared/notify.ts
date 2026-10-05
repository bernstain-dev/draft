// Provider boundary. Never log destination, message, provider body or secrets.
export type Env = (name: string) => string | undefined;
export interface NotifyResult {
  ok: boolean; provider: 'twilio' | 'none'; accepted: boolean; stubbed: boolean;
  status: 'accepted' | 'failed' | 'unknown' | 'stubbed';
  reference: string | null; error: string | null; retry: boolean; delivery: 'not_verified';
}
export function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/[ ()-]/g, '');
  if (/^09\d{9}$/.test(compact)) return '+63' + compact.slice(1);
  if (/^639\d{9}$/.test(compact)) return '+' + compact;
  return /^\+[1-9]\d{6,14}$/.test(compact) ? compact : null;
}
export async function sendNotification(phone: string | null, text: string, env: Env, network: typeof fetch = fetch): Promise<NotifyResult> {
  const result = (status: NotifyResult['status'], error: string | null, reference: string | null = null, retry = false): NotifyResult => ({
    ok: status === 'accepted', provider: status === 'stubbed' ? 'none' : 'twilio', accepted: status === 'accepted',
    stubbed: status === 'stubbed', status, reference, error, retry, delivery: 'not_verified',
  });
  if (!phone) return result('stubbed', 'no_destination');
  const destination = normalizePhone(phone);
  if (!destination) return result('failed', 'invalid_destination');
  const sid = env('TWILIO_ACCOUNT_SID'), token = env('TWILIO_AUTH_TOKEN'), from = env('TWILIO_FROM_NUMBER');
  if (!sid || !token || !from) return result('stubbed', 'not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await network(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST', headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: from, To: destination, Body: text,
        ...(env('NOTIFY_STATUS_CALLBACK_URL') ? { StatusCallback: env('NOTIFY_STATUS_CALLBACK_URL')! } : {}) }), signal: controller.signal,
    });
    if (response.status >= 500) return result('unknown', 'transport_unknown');
    if (response.status === 429) return result('failed', 'rate_limited', null, true);
    if (!response.ok) return result('failed', 'provider_rejected');
    const body = await response.json();
    if (!body || typeof body.sid !== 'string' || !/^SM[0-9a-f]{32}$/i.test(body.sid)) return result('unknown', 'transport_unknown');
    if (body.error_code || ['failed', 'undelivered', 'canceled'].includes(body.status)) return result('failed', 'provider_rejected');
    return result('accepted', null, body.sid);
  } catch { return result('unknown', 'transport_unknown'); }
  finally { clearTimeout(timer); }
}
