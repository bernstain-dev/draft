import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePatientAuth } from './auth/patientAuth';
import LoginShell, { LoginOptionsRow } from '../../components/LoginShell';
import PasswordInput from '../../components/PasswordInput';

export default function PatientLogin() {
  const { signIn, signUp } = usePatientAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const msg =
      mode === 'signin'
        ? await signIn(email.trim(), password)
        : await signUp(fullName, email.trim(), password);
    setBusy(false);
    if (msg) setErr(msg);
    else nav('/patient/dashboard', { replace: true });
  }

  return (
    <LoginShell
      brand="RHU PORTAL"
      portalTag="PATIENT"
      title="My Health Portal"
      features={[
        'Book an Appointment',
        'My Appointments',
        'Appointment History',
        'Doctor Information',
        'Reminders & Updates',
      ]}
      tabs={[
        { label: 'Patient Login', to: '/patient/login', active: true },
        { label: 'Admin Login', to: '/appointments/login', active: false },
      ]}
    >
      <div className="mb-4 flex rounded-xl bg-[#cfe4d0]/40 p-1 text-center text-xs font-bold ring-1 ring-[#0e4a3a]/10">
        <button
          type="button"
          onClick={() => {
            setMode('signin');
            setErr(null);
          }}
          className={`flex-1 rounded-lg px-2 py-2 ${mode === 'signin' ? 'bg-[#0e4a3a] text-white' : 'text-[#123524]'}`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('signup');
            setErr(null);
          }}
          className={`flex-1 rounded-lg px-2 py-2 ${mode === 'signup' ? 'bg-[#0e4a3a] text-white' : 'text-[#123524]'}`}
        >
          Create account
        </button>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        {mode === 'signup' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Full name</label>
            <input
              className="w-full rounded-lg border-[1.5px] border-[#0f3d2e]/80 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#4ea895]"
              type="text"
              placeholder="Juan Dela Cruz"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
          <input
            className="w-full rounded-lg border-[1.5px] border-[#0f3d2e]/80 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#4ea895]"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Password</label>
          <PasswordInput
            className="w-full rounded-lg border-[1.5px] border-[#0f3d2e]/80 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#4ea895]"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
          />
        </div>
        <LoginOptionsRow />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button
          className="w-full rounded-lg bg-[#0a3a23] px-4 py-2.5 text-sm font-bold tracking-wide text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          disabled={busy}
        >
          {busy ? 'PLEASE WAIT…' : mode === 'signin' ? 'LOGIN' : 'CREATE ACCOUNT'}
        </button>
      </form>
    </LoginShell>
  );
}
