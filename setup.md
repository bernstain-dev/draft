# Setup Guide — MedicAppointment

Local development setup from zero to running app.

## Prerequisites

- **Node.js 18+** and **npm** (`node -v`, `npm -v`)
- **Git**
- A **Supabase** project (free tier is fine):
  - Project URL — `https://<project-ref>.supabase.co`
  - `anon` public key — Project Settings → API
  - (Only for admin bootstrap / scripts) `service_role` key — keep secret,
    never put it in `.env` or frontend code
- Optional: Supabase CLI (only if deploying Edge Functions / cron)

## 1. Clone and install

```bash
git clone https://github.com/vacunawajayare-pixel/MedicAppointment.git
cd MedicAppointment   # folder on disk is MedicalAppointment
npm install
```

## 2. Environment file

```bash
cp .env.example .env
```

Edit `.env`:

```ini
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_NOTIFY_ENABLED=false
```

- Leave `VITE_NOTIFY_ENABLED=false` until the `send-confirmation`
  Edge Function is deployed (otherwise booking skips the invoke —
  this is intentional, avoids CORS noise).
- `.env` is git-ignored. Never commit keys.

## 3. Database — schema

1. Open your Supabase project → **SQL Editor**.
2. Paste the entire `supabase/full.sql` and run it (one-click: schema +
   demo data; use `supabase/schema.sql` instead for schema only).
   - Safe to re-run (all statements are `IF NOT EXISTS` / `DROP IF EXISTS` /
     `CREATE OR REPLACE` / `ON CONFLICT DO NOTHING`).
   - This creates tables, indexes (incl. double-booking guard
     `uq_doctor_slot`), RLS policies (staff + patient), and the booking
     RPCs (`book_appointment` / `reschedule_appointment` /
     `cancel_appointment`), plus 10 doctors with Mon–Sun schedules,
     10 patients, and demo appointments.
3. Upgrading a database created with the old (pre-cleanup) schema?
   Run `supabase/migrate_patient_booking.sql` instead — fresh installs
   don't need it.

## 4. Accounts + demo data — one seeder

`supabase/seed.cjs` is the single seeder (accounts **and** demo data).
It needs the `service_role` key via environment (never in `.env`):

```powershell
$env:SUPABASE_URL="https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
$env:SUPABASE_ANON_KEY="<anon-key>"   # optional, for the login smoke test
node supabase/seed.cjs
```

It creates (idempotent — safe to re-run):

| Email | Password | Role | Portal |
|---|---|---|---|
| `vacunawa@gmail.com` | `admin123` | `admin` | `/appointments/login` |
| `patient@gmail.com` | `patient123` | `patient` | `/patient/login` |

plus demo data: 10 doctors (General Medicine, Pediatrics, OB-Gyne,
Dentistry, Cardiology, Dermatology, Ophthalmology, ENT, Orthopedics,
Internal Medicine) with Mon–Sun 08:00–17:00 schedules, 10 patients, and
appointments across yesterday / today / tomorrow / next week covering
every status — so staff Dashboard, Booking, Check-in, Patients, Doctors,
Reports, and the patient portal (Dashboard / Book an Appointment /
My Appointments / History) all render immediately. The patient demo
account is linked to "Maria Santos", who already has upcoming visits.

> Auth passwords are hashed by GoTrue and **cannot** be inserted with
> SQL — that is why accounts live in the seeder (Admin API), not in a
> `.sql` file. Prefer creating extra users the same way, or via
> Authentication → Users in the Dashboard (patients can also
> self-sign-up at `/patient/login` → Create account).

The staff login form pre-fills `vacunawa@gmail.com` for convenience.

## 5. Run the app

```bash
npm run dev
```

Open **http://localhost:5173** (Vite default for this project: port `5173`).

| URL | Login | Result |
|---|---|---|
| `/patient/login` | `patient@gmail.com` / `patient123` | Patient portal (`/patient/dashboard` …) |
| `/appointments/login` | `vacunawa@gmail.com` / `admin123` | Staff workspace (`/appointments/dashboard` …) |

## 6. Build / preview

```bash
npm run build     # type-check + build to dist/
npm run preview   # serve the production build locally
```

> Windows PowerShell note: `npm run build` may fail with
> `error TS5025: Unknown compiler option '--noEmit;'` because the script
> uses `;` (not a `cmd.exe` separator). Run instead:
> ```powershell
> npx tsc --noEmit; if ($?) { npx vite build }
> ```

## 7. Notifications (optional)

Edge Functions are provider-agnostic stubs — with no keys configured they
log and return `stubbed: true`, and booking shows "logged (no provider)".

1. Read `supabase/NOTIFICATIONS.md` (source of truth).
2. Deploy:
   ```bash
   supabase functions deploy send-confirmation
   supabase functions deploy send-reminders
   supabase secrets set CRON_SECRET=$(openssl rand -hex 32)
   ```
3. When ready to send for real:
   ```bash
   supabase secrets set RESEND_API_KEY=... NOTIFY_FROM_EMAIL=...
   supabase secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=...
   ```
4. Fill `<PROJECT_REF>` / `<CRON_SECRET>` in `supabase/cron.sql` and run it
   (or schedule 07:00 daily in Dashboard → Edge Functions → Schedules).
5. Set `VITE_NOTIFY_ENABLED=true` in `.env` and restart dev server.
6. Test: book an appointment → "Confirmation sent ✓".

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY` | `.env` missing or dev server started before creating it — create `.env`, restart `npm run dev` |
| Login succeeds but redirected back to login | No `profiles` row / wrong `role` for that portal — check `select * from profiles where id = '<uuid>'`; staff portal needs `admin`, patient portal needs `patient` (re-run the seeder or fix the role in Settings → User roles) |
| Booking shows notification error / CORS noise | `VITE_NOTIFY_ENABLED` is true but function not deployed — set it back to `false` until deployed |
| `TS5025 --noEmit;` on `npm run build` (Windows) | See §6 workaround |
| Port 5173 in use | `npx vite --port 5174` or stop the other process |
| Pushed 403 `Permission denied` | Collaborator invite not accepted or stale Windows credential — accept invite as that GitHub user, then `echo "url=https://github.com" \| git credential-manager reject` and push again |
