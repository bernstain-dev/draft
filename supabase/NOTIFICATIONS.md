# Notifications (Stage 5)

Two Edge Functions, provider-agnostic stubs. Everything works with **no
provider configured** (messages are logged, `stubbed: true`); add Resend /
Twilio keys later to send for real without code changes.

## Functions

| Function | Trigger | Auth | What it does |
|---|---|---|---|
| `send-confirmation` | Staff app invokes after booking | Caller JWT must be `admin` | Loads appointment + patient + doctor (service-role read), sends confirmation |
| `send-reminders` | Cron daily 07:00 (`supabase/cron.sql`) | `x-cron-secret` or service_role (no user JWTs) | Reminds all `scheduled` appointments tomorrow |

Shared stub logic lives in `supabase/functions/_shared/notify.ts`:
- Email via **Resend** if `RESEND_API_KEY` (+ optional `NOTIFY_FROM_EMAIL`) is set.
- SMS via **Twilio** if `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` are set.
- Otherwise logs to function logs and returns `stubbed: true`.

Note: `patients` currently stores `contact_number` (used as SMS
destination). To send email, add a `patients.email` column and pass it as
`to_email` in both functions (one line each, marked in code comments).

## Deploy

```bash
supabase functions deploy send-confirmation
supabase functions deploy send-reminders
supabase secrets set CRON_SECRET=$(openssl rand -hex 32)
# when ready:
supabase secrets set RESEND_API_KEY=... NOTIFY_FROM_EMAIL=...
supabase secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=...
```

Then fill in `<PROJECT_REF>` / `<CRON_SECRET>` in `supabase/cron.sql` and run
it (or create the 07:00 schedule in Dashboard > Edge Functions > Schedules).

## Test

1. Book an appointment in `/appointments/booking` → message line should say
   "Confirmation sent ✓" (or "logged (no provider)" when stubbed).
2. `curl -X POST $URL/functions/v1/send-reminders -H "x-cron-secret: $CRON_SECRET"`
   → `{ ok: true, sent, stubbed, failed }`.
