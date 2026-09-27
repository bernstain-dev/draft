import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../lib/theme';

// Pure presentational login shell — NO auth logic lives here. Login
// pages reuse it; sign-in handlers stay in each page (staffAuth /
// patientAuth are never imported here, keeping the hard boundary).
// Brand source-of-truth: mint/cream + pine greens (see tailwind brand colors).

export interface LoginTab {
  label: string;
  to: string;
  active: boolean;
}

interface ShellProps {
  brand: string;
  portalTag: string;
  title: string;
  features: string[];
  tabs: LoginTab[];
  children: ReactNode;
}

function FeatureIcon({ label }: { label: string }) {
  const l = label.toLowerCase();
  const cls = 'h-4 w-4';
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;

  if (l.includes('schedul') || l.includes('appoint') || l.includes('book')) {
    return (
      <svg viewBox="0 0 24 24" className={cls} {...stroke}>
        <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
        <path d="M7.5 13.5l2.5 2.5 5-5.5" />
      </svg>
    );
  }
  if (l.includes('check-in') || l.includes('check in') || l.includes('visit')) {
    return (
      <svg viewBox="0 0 24 24" className={cls} {...stroke}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M9 20h6M12 16v4" />
        <path d="M7 11l2.5-2.5L12 11l4.5-4.5" />
      </svg>
    );
  }
  if (l.includes('patient') || l.includes('record')) {
    return (
      <svg viewBox="0 0 24 24" className={cls} {...stroke}>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M14 3v5h5M9 13h7M9 17h7" />
      </svg>
    );
  }
  if (l.includes('doctor') || l.includes('staff') || l.includes('manage')) {
    return (
      <svg viewBox="0 0 24 24" className={cls} {...stroke}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c1.2-3.5 3.9-5 7-5s5.8 1.5 7 5" />
        <path d="M12 11.5v3M10.5 13h3" />
      </svg>
    );
  }
  if (l.includes('report') || l.includes('analytic')) {
    return (
      <svg viewBox="0 0 24 24" className={cls} {...stroke}>
        <path d="M4 20V4" />
        <path d="M4 20h16" />
        <path d="M8 16v-5M12 16V8M16 16v-8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={cls} {...stroke}>
      <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
      <path d="M9 12l2 2 4-4.5" />
    </svg>
  );
}

// RHU seal (public/rhu.jpg, copied from image/rhu.jpg) is the left-panel
// background and the header logo.

export default function LoginShell({ brand, portalTag, title, features, tabs, children }: ShellProps) {
  const { theme, setTheme } = useTheme();
  const dark = theme === 'dark';

  return (
    <div className={`login-shell relative flex w-full items-center justify-center overflow-hidden px-3 py-6 sm:p-6 ${dark ? 'login-shell-dark' : 'login-shell-light'}`}>
      {/* Responsive background: gradient base (fills every viewport, no gaps) +
          contained DOH emblem watermark (never cropped, never stretched).
          The source is a 1254px square logo, so `contain` + vmin sizing keeps
          the full artwork visible on portrait/landscape, mobile/tablet/desktop
          without the upscale pixelation / text cut-off that `cover` caused. */}
      <div aria-hidden className="login-bg-layer">
        <img
          src="/background.jpg"
          alt=""
          aria-hidden="true"
          width={1254}
          height={1254}
          loading="eager"
          decoding="async"
          draggable={false}
          onError={(e) => {
            // If the artwork is missing, hide it — the gradient base still
            // covers the viewport so there are no gaps or broken icons.
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
          className="login-bg-photo"
        />
      </div>
      <div
        aria-hidden
        className={`login-bg-wash ${
          dark
            ? 'bg-gradient-to-br from-[#081712]/95 via-[#0f2c22]/90 to-[#081712]/92'
            : 'bg-gradient-to-br from-[#dcecdb]/92 via-[#fdfbe7]/85 to-[#aecfb2]/90'
        }`}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="login-dots absolute right-10 top-10 hidden h-28 w-44 opacity-40 md:block" />
        <div className="login-dots absolute bottom-10 left-10 hidden h-28 w-44 opacity-40 md:block" />
      </div>

      <div
        className={`login-card-in relative w-full max-w-5xl overflow-hidden rounded-[20px] ring-1 backdrop-blur sm:rounded-[28px] md:grid md:grid-cols-[1.05fr_1fr] ${
          dark
            ? 'bg-[#0d1512] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] ring-white/10'
            : 'bg-white shadow-[0_30px_80px_-24px_rgba(16,60,38,0.45)] ring-[#0f3d2e]/10'
        }`}
      >
        {/* Left: brand panel — mint gradient / dark pine gradient */}
        <div
          className={`relative flex flex-col justify-between overflow-hidden p-6 text-white sm:p-8 md:min-h-[520px] lg:p-10 ${
            dark
              ? 'bg-gradient-to-br from-[#14382a] via-[#0f2c22] to-[#081712]'
              : 'bg-gradient-to-br from-[#0e4a3a] via-[#0f2c22] to-[#14382a]'
          }`}
        >
          <div aria-hidden className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#4ea895]/15 blur-2xl" />
          <div aria-hidden className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-black/30 blur-2xl" />

          <div className="relative">
            <div className="flex flex-wrap items-center gap-3">
              <img
                src="/rhu.jpg"
                alt="Aringay Birthing Clinic and RHU logo"
                className="h-12 w-12 shrink-0 rounded-full object-cover shadow-lg ring-2 ring-white/70 sm:h-14 sm:w-14"
              />
              <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-100 ring-1 ring-white/15">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#4ea895]" />
                Rural Health Unit • Philippines
              </span>
            </div>
            <h1 className="mt-4 max-w-[14ch] text-[1.7rem] font-black leading-[1.08] tracking-tight sm:mt-5 sm:text-4xl lg:text-[2.75rem]">
              {title}
            </h1>
            <p className="mt-2 max-w-[38ch] text-[13px] leading-relaxed text-emerald-100/80 sm:mt-3 sm:text-sm">
              One secure portal for appointments, schedules, records, and reports.
            </p>

            <ul className="mt-5 space-y-2 sm:mt-7 sm:space-y-2.5">
              {features.map((f) => (
                <li
                  key={f}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.08] px-3 py-2 text-[12px] font-semibold text-emerald-50 ring-1 ring-white/15 backdrop-blur transition-transform duration-200 hover:-translate-y-px hover:bg-white/[0.12] sm:py-2.5 sm:text-[13px]"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0e4a3a] text-white shadow-sm ring-1 ring-white/20">
                    <FeatureIcon label={f} />
                  </span>
                  <span className="flex-1">{f}</span>
                  <span className="text-xs text-[#4ea895]">✓</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-4 text-[11px] font-medium text-emerald-100/70 sm:mt-8">
              <span className="inline-flex items-center gap-1.5">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <rect x="5" y="10" width="14" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 018 0v3" />
                </svg>
                Secure sign-in
              </span>
            <span>v0.2.0</span>
          </div>
        </div>

        {/* Right: form panel — cream / dark pine */}
        <div className={dark ? 'relative flex flex-col bg-[#101815] p-6 sm:p-8 lg:p-10' : 'relative flex flex-col bg-[#fdfbe7] p-6 sm:p-8 lg:p-10'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-2 text-sm font-black tracking-wide ${dark ? 'text-green-50' : 'text-[#123524]'}`}>
              <img
                src="/rhu.jpg"
                alt="Aringay Birthing Clinic and RHU logo"
                className="h-7 w-7 rounded-full object-cover ring-1 ring-[#0e4a3a]/30"
              />
              {brand}
            </span>
            <span className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black tracking-wider ${dark ? 'bg-white/10 text-emerald-100' : 'bg-[#cde6cf] text-[#123524]'}`}>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4ea895]" />
                {portalTag}
              </span>
              <button
                type="button"
                title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                onClick={() => setTheme(dark ? 'light' : 'dark')}
                className={`flex h-7 w-7 items-center justify-center rounded-full shadow-sm ring-1 transition-colors ${
                  dark ? 'bg-white/10 text-amber-200 ring-white/10 hover:bg-white/15' : 'bg-white/70 text-slate-500 ring-black/5 hover:text-slate-800'
                }`}
              >
                {dark ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                    <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" />
                  </svg>
                )}
              </button>
            </span>
          </div>

          <h2 className={`mt-5 text-2xl font-black tracking-tight sm:mt-7 sm:text-[1.7rem] ${dark ? 'text-white' : 'text-[#10281a]'}`}>
            Login
          </h2>
          <p className={`mt-1 text-[13px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            Welcome back — sign in to continue to your portal.
          </p>

          <div className="mt-4 flex overflow-hidden rounded-xl text-center text-[11px] font-bold shadow-inner ring-1 ring-[#0b4e4b]/10 sm:text-[12px]">
            {tabs.map((t) =>
              t.active ? (
                <span key={t.label} className="flex min-w-0 flex-1 items-center justify-center gap-1.5 bg-[#4ea895] px-2 py-2.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] sm:py-3">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <circle cx="12" cy="8" r="3.5" />
                    <path d="M5 20c1.2-3.5 3.9-5 7-5s5.8 1.5 7 5" />
                  </svg>
                  {t.label}
                </span>
              ) : (
                <Link key={t.label} to={t.to} className="flex min-w-0 flex-1 items-center justify-center gap-1.5 truncate bg-[#0b4e4b] px-2 py-2.5 text-white/85 transition-colors hover:bg-[#0d5c59] hover:text-white sm:py-3">
                  {t.label}
                </Link>
              ),
            )}
          </div>

          <div className={`${dark ? 'login-form-dark' : ''} mt-5 flex-1`}>{children}</div>

          <p className={`mt-6 text-center text-[11px] leading-relaxed ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            Having trouble signing in? Contact your administrator.
            <br />
            <span className="font-semibold">Protected by RHU Portal • Privacy-first</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// "Remember me / Forgot password" row — display only, no auth behavior.
export function LoginOptionsRow() {
  const [hint, setHint] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <label className="group flex cursor-pointer items-center gap-2 text-slate-600">
          <span className="relative inline-flex">
            <input
              type="checkbox"
              defaultChecked
              className="peer h-4 w-4 appearance-none rounded-[5px] border-[1.5px] border-[#0f3d2e]/50 bg-white transition-colors checked:border-[#0e4a3a] checked:bg-[#0e4a3a] focus:outline-none focus:ring-2 focus:ring-[#4ea895]/40"
            />
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute inset-0 h-4 w-4 p-[3px] text-white opacity-0 transition-opacity peer-checked:opacity-100"
              fill="none"
              stroke="currentColor"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
          </span>
          <span className="font-medium group-hover:text-slate-800">Save User</span>
        </label>
        <button
          type="button"
          className="text-[11px] font-bold tracking-wider text-slate-400 underline-offset-4 hover:text-[#0e4a3a] hover:underline"
          onClick={() => setHint((h) => !h)}
        >
          FORGET PASSWORD?
        </button>
      </div>
      {hint && (
        <p className="mt-2 rounded-lg bg-[#cfe4d0]/50 px-3 py-2 text-xs leading-relaxed text-[#123524] ring-1 ring-[#0e4a3a]/20">
          Contact your administrator for a password reset. Bring your staff ID for verification.
        </p>
      )}
    </div>
  );
}
