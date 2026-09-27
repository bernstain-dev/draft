// send-confirmation — POST { "appointment_id": "<uuid>" }
// Called by the admin app right after booking (best-effort; booking succeeds
// even if this fails). Requires the caller's JWT: only the admin role is
// accepted (logins are admin + patient).
// Deploy: supabase functions deploy send-confirmation
// Secrets: supabase secrets set RESEND_API_KEY=... NOTIFY_FROM_EMAIL=... [TWILIO_*=...]
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { json, sendNotification } from '../_shared/notify.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'missing Authorization' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'invalid session' }, 401);
  const { data: profile } = await userClient.from('profiles').select('role').eq('id', user.id).single();
  const role = (profile as { role?: string } | null)?.role;
  if (role !== 'admin') {
    return json({ error: 'admin only' }, 403);
  }

  let body: { appointment_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  if (!body.appointment_id) return json({ error: 'appointment_id required' }, 400);

  // Service-role read so confirmations work even if RLS would hide rows.
  const svc = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: appt, error } = await svc
    .from('appointments')
    .select('id,scheduled_time,source,room,status,patient:patients(full_name,contact_number),doctor:doctors(full_name,specialty)')
    .eq('id', body.appointment_id)
    .single();
  if (error || !appt) return json({ error: 'appointment not found' }, 404);
  const a = appt as unknown as {
    scheduled_time: string;
    room: string | null;
    patient?: { full_name: string; contact_number: string | null } | null;
    doctor?: { full_name: string } | null;
  };
  const when = new Date(a.scheduled_time).toLocaleString();
  const text =
    `Hi ${a.patient?.full_name ?? 'patient'}, your appointment with ${a.doctor?.full_name ?? 'the doctor'} is confirmed for ${when}` +
    (a.room ? ` (Room ${a.room})` : '') + `. Reply STOP to opt out.`;
  const results = await sendNotification({
    // contact_number doubles as the SMS destination; email column can be added later.
    to_phone: a.patient?.contact_number ?? null,
    to_email: null,
    subject: 'Appointment confirmed',
    text,
  });
  return json({ ok: true, stubbed: results.every((r) => r.stubbed), results });
});
