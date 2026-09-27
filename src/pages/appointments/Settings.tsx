import { useEffect, useState } from 'react';
import { getStaffClient, useStaffAuth } from './auth/staffAuth';
import { useTheme } from '../../lib/theme';
import PasswordInput from '../../components/PasswordInput';
import type { Profile } from '../../lib/types';

const ROLES = ['admin', 'patient'];

export default function Settings() {
  const sb = getStaffClient();
  const { user, profile, role } = useStaffAuth();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const isAdmin = role === 'admin';
  const notifyOn = (import.meta.env.VITE_NOTIFY_ENABLED as string | undefined) === 'true';

  async function loadUsers() {
    if (!isAdmin) return;
    const { data, error } = await sb.from('profiles').select('*').order('full_name');
    if (!error) setUsers((data as Profile[]) ?? []);
  }

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !name.trim()) return;
    const { error } = await sb.from('profiles').update({ full_name: name.trim() }).eq('id', user.id);
    if (error) setMsg(error.message);
    else {
      setMsg('Display name saved — reloading…');
      setTimeout(() => window.location.reload(), 800);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw1.length < 6) {
      setMsg('Password must be at least 6 characters.');
      return;
    }
    if (pw1 !== pw2) {
      setMsg('Passwords do not match.');
      return;
    }
    const { error } = await sb.auth.updateUser({ password: pw1 });
    if (error) setMsg(error.message);
    else {
      setMsg('Password changed ✓');
      setPw1('');
      setPw2('');
    }
  }

  async function setRole(id: string, next: string) {
    const { error } = await sb.from('profiles').update({ role: next }).eq('id', id);
    if (error) setMsg(error.message);
    else {
      setMsg('Role updated.');
      setUsers(users.map((u) => (u.id === id ? { ...u, role: next } : u)));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      {msg && <p className="text-sm text-slate-300">{msg}</p>}

      <div className="dk-panel">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Appearance</h2>
            <p className="mt-1 text-xs text-slate-500">
              {theme === 'dark' ? 'Dark mode.' : 'Light mode.'} Applies to the staff section instantly and is remembered on this device.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={theme === 'dark'}
            aria-label="Toggle dark mode"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={`relative h-8 w-[68px] shrink-0 rounded-full ring-1 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#4ea895] ${
              theme === 'dark' ? 'bg-[#0e4a3a] ring-[#4ea895]/40' : 'bg-[#cde6cf] ring-[#0e4a3a]/20'
            }`}
          >
            {/* moon = dark, left */}
            <span className={`absolute left-2 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-white' : 'text-[#0e4a3a]/40'}`}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" />
              </svg>
            </span>
            {/* sun = light, right */}
            <span className={`absolute right-2 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-white/40' : 'text-amber-500'}`}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            </span>
            <span
              className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all duration-200 ${
                theme === 'dark' ? 'left-1' : 'left-[38px]'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={saveName} className="dk-panel space-y-3">
          <h2 className="font-semibold">My profile</h2>
          <p className="text-xs text-slate-500">Signed in as {profile?.full_name} · role: {role}</p>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Display name</label>
            <input className="dk-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="dk-btn-primary" type="submit">Save name</button>
        </form>

        <form onSubmit={savePassword} className="dk-panel space-y-3">
          <h2 className="font-semibold">Change password</h2>
          <div>
            <label className="mb-1 block text-xs text-slate-500">New password (min 6 chars)</label>
            <PasswordInput
              className="dk-input"
              toggleClassName="text-slate-400 hover:text-slate-200"
              value={pw1}
              onChange={setPw1}
              autoComplete="new-password"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Confirm password</label>
            <PasswordInput
              className="dk-input"
              toggleClassName="text-slate-400 hover:text-slate-200"
              value={pw2}
              onChange={setPw2}
              autoComplete="new-password"
              required
            />
          </div>
          <button className="dk-btn-primary" type="submit">Change password</button>
        </form>
      </div>

      <div className="dk-panel">
        <h2 className="font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-slate-400">
          Appointment confirmations via Edge Function:{' '}
          <span className={notifyOn ? 'font-semibold text-green-400' : 'font-semibold text-slate-500'}>
            {notifyOn ? 'ON' : 'OFF'}
          </span>
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Controlled by the VITE_NOTIFY_ENABLED build flag (.env). Set it to 'true' only after deploying
          the send-confirmation function, then restart the dev server.
        </p>
      </div>

      {isAdmin ? (
        <div className="dk-panel">
          <h2 className="font-semibold">User roles (admin)</h2>
          <p className="mt-1 text-xs text-slate-500">
            New logins are created via Supabase Auth or seed.cjs — role changes happen here.
            Patient accounts use role <span className="font-semibold">patient</span>.
          </p>
          <div className="mt-2 divide-y divide-white/5">
            {users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-medium">{u.full_name}</span>
                {u.device_label && <span className="text-xs text-slate-500">· {u.device_label}</span>}
                <select
                  className="dk-input ml-auto max-w-[160px]"
                  value={u.role}
                  disabled={u.id === user?.id}
                  title={u.id === user?.id ? 'You cannot change your own role' : 'Change role'}
                  onChange={(e) => void setRole(u.id, e.target.value)}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            ))}
            {users.length === 0 && <p className="py-2 text-sm text-slate-500">No users found.</p>}
          </div>
        </div>
      ) : (
        <div className="dk-panel">
          <p className="text-sm text-slate-500">User management is visible to admins only.</p>
        </div>
      )}
    </div>
  );
}
