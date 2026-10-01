import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStaffAuth } from './auth/staffAuth';
import LoginShell, { LoginOptionsRow } from '../../components/LoginShell';
import PasswordInput from '../../components/PasswordInput';

// Logic below is unchanged: staff-only sign-in, navigate to dashboard.
export default function StaffLogin() {
  const { signIn } = useStaffAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('vacunawa@gmail.com');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const msg = await signIn(email.trim(), password);
    setBusy(false);
    if (msg) setErr(msg);
    else nav('/appointments/dashboard', { replace: true });
  }

  return (
    <LoginShell
      brand="RHU PORTAL"
      portalTag="ADMIN"
      title="Clinic Admin Portal"
      features={[
        'Appointment Scheduling',
        'Patient Records',
        'Doctor Management',
        'Reports & Analytics',
        'Check-in',
      ]}
      tabs={[
        { label: 'Admin Login', to: '/appointments/login', active: true },
        { label: 'Patient Login', to: '/patient/login', active: false },
      ]}
    >
      <form onSubmit={onSubmit} className="space-y-3">
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
            autoComplete="current-password"
            required
          />
        </div>
        <LoginOptionsRow />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button
          className="w-full rounded-lg bg-[#0a3a23] px-4 py-2.5 text-sm font-bold tracking-wide text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          disabled={busy}
        >
          {busy ? 'SIGNING IN…' : 'LOGIN'}
        </button>
      </form>
    </LoginShell>
  );
}
