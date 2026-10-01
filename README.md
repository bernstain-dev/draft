# MedicAppointment

Patient appointment booking + clinic staff portal for a Rural Health Unit (RHU).
Patients choose a doctor, pick an available date and time, and manage their
own visits. Staff manage appointments, check-ins, patients, doctors, and reports.

> Full local setup: see **[setup.md](./setup.md)**.

## Features

**Patient portal** (`/patient/*`)
- Book an Appointment: choose a doctor → available date → available time → review → confirm
- My Appointments (view / reschedule / cancel), Appointment History, Profile, Settings
- Patient-friendly language throughout — no queue numbers or queue statuses

**Staff portal** (`/appointments/*`)
- Dashboard, appointment booking with slot picker, check-in / status flow
- Patients, doctors (+ schedules / unavailable dates), reports, settings
- Dark / light theme (persisted, follows OS on first visit)
- Responsive login with DOH emblem watermark that never crops or stretches

**Platform**
- Role-based access (RLS): `admin` manages everything, `patient` books own visits
- Backend booking validation (`book_appointment` / `reschedule_appointment` /
  `cancel_appointment` RPCs) + double-booking blocked by unique index
- Booking confirmation + daily reminder Edge Functions
  (provider-agnostic stubs — log only until Resend/Twilio keys are added).
  Details: `supabase/NOTIFICATIONS.md`

## Tech stack

| Layer | Choice |
|---|---|
| UI | React 18, React Router 6, Tailwind CSS 3 |
| Build | Vite 5, TypeScript 5 |
| Backend | Supabase (Auth, Postgres + RLS, Realtime, Edge Functions) |
| Dev server port | `5173` |

## Routes

| Path | Who | What |
|---|---|---|
| `/` | — | Redirects to `/patient/login` |
| `/patient/login` | Patient | Patient sign-in / sign-up |
| `/patient/dashboard`, `/book`, `/appointments`, `/history`, `/profile`, `/settings` | `patient` | Patient workspace |
| `/appointments/login` | Admin | Admin sign-in |
| `/appointments/dashboard` … `/booking`, `/check-in`, `/patients`, `/doctors`, `/reports`, `/settings` | `admin` | Staff workspace |

Staff and patient sessions are isolated (separate Supabase clients / storage keys) —
a staff login never leaks into the patient portal and vice versa.

## Quickstart

```bash
npm install
cp .env.example .env   # then fill in your Supabase values
npm run dev            # http://localhost:5173
```

Then set up the database and users per **[setup.md](./setup.md)**.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Preview the production build |

> Windows note: `npm run build` runs `tsc --noEmit; vite build`, and `;`
> is not a `cmd.exe` separator, so it can fail with
> `error TS5025: Unknown compiler option '--noEmit;'`.
> Workaround in PowerShell:
> `npx tsc --noEmit; if ($?) { npx vite build }`

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | e.g. `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon (public) key |
| `VITE_NOTIFY_ENABLED` | No | Set `'true'` only after deploying the `send-confirmation` Edge Function; otherwise booking skips the invoke (default off) |

See `.env.example`. Never commit `.env` (already git-ignored).

## Project structure

```
├── index.html
├── public/
│   ├── background.jpg        # DOH emblem (login watermark, contained — never cover)
│   └── rhu.jpg               # RHU logo / favicon
├── src/
│   ├── App.tsx               # route groups: /patient/*, /appointments/*
│   ├── main.tsx
│   ├── index.css             # Tailwind + responsive login-background system
│   ├── components/LoginShell.tsx
│   ├── lib/                  # theme, supabase client factory, slots, types, patient helpers
│   └── pages/
│       ├── patient/          # patient portal + auth/
│       └── appointments/     # staff portal + auth/
├── supabase/
│   ├── schema.sql            # full schema + RLS + booking RPCs (run once, re-runnable)
│   ├── full.sql              # ONE-CLICK: schema + RLS + RPCs + demo data (run once instead of schema.sql)
│   ├── migrate_patient_booking.sql  # upgrade path for pre-cleanup databases only
│   ├── seed.cjs              # THE seeder: accounts + demo data (service_role)
│   ├── cron.sql / rls_tests.sql
│   └── functions/            # send-confirmation, send-reminders, _shared/notify
└── scripts/verify.mjs   # static + live checks (queue-free, patient booking)
```

## Database & auth (summary)

1. Run `supabase/full.sql` once in the Supabase SQL Editor
   (one-click: schema + demo data; or `schema.sql` for schema only).
2. Run `node supabase/seed.cjs` (needs `SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY` in env) — creates logins and demo data.
3. Sign in: patient `patient@gmail.com` / `patient123`,
   staff `vacunawa@gmail.com` / `admin123`
   (passwords can't be inserted via SQL — the seeder creates them via API).

Full steps: **[setup.md](./setup.md)**.
