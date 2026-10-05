import { Bell, LockKeyhole, Moon, RefreshCw, Sun } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import { useClinicQuery } from '../../lib/useClinicQuery';
import { useMutation } from '../../lib/useMutation';
import { textError } from '../../lib/formValidation';
import QueryState from '../../components/QueryState';
import { useEffect, useState } from 'react';
import { getStaffClient, useStaffAuth } from './auth/staffAuth';
import { useTheme } from '../../lib/theme';
import PasswordInput from '../../components/PasswordInput';
import type { Profile } from '../../lib/types';

const ROLES = ['admin', 'patient'];

export default function Settings() {
  const sb = getStaffClient();
  const { user, profile, role, refreshIdentity } = useStaffAuth();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const mutation = useMutation(setMsg);
  const [userRevision, setUserRevision] = useState(0);
  const isAdmin = role === 'admin';
  const notifyOn = (import.meta.env.VITE_NOTIFY_ENABLED as string | undefined) === 'true';

  const list = useClinicQuery<Profile[]>(isAdmin ? `${user?.id}/${userRevision}` : '', async signal => {
    const { data, error } = await sb.from('profiles').select('*').order('full_name').abortSignal(signal);
    if (error) throw new Error(error.message);
    return data as Profile[] ?? [];
  }, []);
  const users = list.data;
  const notificationQuery = useClinicQuery<{ id: string; notification_type: string; status: string; delivery_status: string; attempt_count: number }[]>(isAdmin ? `notification-status/${user?.id}/${userRevision}` : '', async signal => {
    const { data, error } = await sb.from('notification_attempts').select('id,notification_type,status,delivery_status,attempt_count').order('created_at', { ascending: false }).limit(50).abortSignal(signal);
    if (error) throw new Error(error.message);
    return data ?? [];
  }, []);
  useEffect(() => setName(profile?.full_name ?? ''), [profile?.full_name]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    await mutation.run(async () => {
      if (!user) return;
      const validation = textError(name, 'Display name', 300, true);
      if (validation) { setMsg(validation); return; }
      const { data, error } = await sb.from('profiles').update({ full_name: name.trim() }).eq('id', user.id).select('id').single();
      if (error) setMsg(error.message);
      else {
        if (!data) { setMsg('Display-name save could not be confirmed.'); return; }
        setMsg('Display name saved.'); await refreshIdentity();
      }
    });
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    await mutation.run(async () => {
      if (pw1.length < 8) {
        setMsg('Password must be at least 8 characters.');
        return;
      }
      if (pw1 !== pw2) {
        setMsg('Passwords do not match.');
        return;
      }
      const { error } = await sb.auth.updateUser({ password: pw1 });
      if (error) setMsg(error.message);
      else {
        setMsg('Password changed.');
        setPw1('');
        setPw2('');
      }
    });
  }

  async function setRole(id: string, next: string) {
    await mutation.run(async () => {
      if (!isAdmin || id === user?.id || !ROLES.includes(next)) { setMsg('Invalid role change.'); return; }
      const { data, error } = await sb.rpc('admin_set_profile_role', { p_profile_id: id, p_role: next });
      if (error) setMsg(error.message);
      else {
        setMsg('Role updated.');
        if (!data?.success) { setMsg('Role update could not be confirmed.'); return; }
        setUserRevision(r => r + 1);
      }
    });
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
          <button disabled={mutation.pending}
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
              <AppIcon icon={Moon} size={16} />
            </span>
            {/* sun = light, right */}
            <span className={`absolute right-2 top-1/2 -translate-y-1/2 ${theme === 'dark' ? 'text-white/40' : 'text-amber-500'}`}>
              <AppIcon icon={Sun} size={16} />
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
          <button disabled={mutation.pending} className="dk-btn-primary" type="submit">Save name</button>
        </form>

        <form onSubmit={savePassword} className="dk-panel space-y-3">
          <h2 className="font-semibold">Change password</h2>
          <div>
            <label className="mb-1 block text-xs text-slate-500 icon-label"><AppIcon icon={LockKeyhole} size={16} />New password (min 8 chars)</label>
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
            <label className="mb-1 block text-xs text-slate-500 icon-label"><AppIcon icon={LockKeyhole} size={16} />Confirm password</label>
            <PasswordInput
              className="dk-input"
              toggleClassName="text-slate-400 hover:text-slate-200"
              value={pw2}
              onChange={setPw2}
              autoComplete="new-password"
              required
            />
          </div>
          <button disabled={mutation.pending} className="dk-btn-primary" type="submit">Change password</button>
        </form>
      </div>

      <div className="dk-panel">
        <h2 className="font-semibold"><AppIcon icon={Bell} size={18} /> Notifications</h2>
        <p className="mt-1 text-sm text-slate-400">
          Immediate notification requests:{' '}
          <span className={notifyOn ? 'font-semibold text-green-400' : 'font-semibold text-slate-500'}>
            {notifyOn ? 'ON' : 'OFF'}
          </span>
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Browser invocation is controlled by deployment configuration. Provider acceptance and delivery remain separate; the durable worker handles queued notices independently.
        </p>
        <button className="dk-btn-ghost icon-button mt-2" onClick={() => setUserRevision(r => r + 1)}><AppIcon icon={RefreshCw} size={17} />Refresh notification status</button>
        <QueryState query={notificationQuery} label="notification status" />
        {!notificationQuery.loading && !notificationQuery.error && <div className="mt-2 text-xs">
          <p>Most recent 50 attempts. Accepted is not proof of delivery. Unknown attempts require provider review before any resend.</p>
          {notificationQuery.data.map(n => <p key={n.id}>{n.notification_type} · {n.status} · delivery: {n.delivery_status} · attempts: {n.attempt_count}</p>)}
          {!notificationQuery.data.length && <p>No notification attempts recorded.</p>}
        </div>}
      </div>

      {isAdmin ? (
        <div className="dk-panel">
          <h2 className="font-semibold">User roles (admin)</h2>
          <QueryState query={list} label="users" />
          <p className="mt-1 text-xs text-slate-500">
            Create real accounts through Supabase Auth. Role changes use an authorized admin operation; demonstration seeders are local-only.
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
                  disabled={mutation.pending || u.id === user?.id}
                  title={u.id === user?.id ? 'You cannot change your own role' : 'Change role'}
                  onChange={(e) => void setRole(u.id, e.target.value)}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            ))}
            {!list.loading && !list.error && users.length === 0 && <p className="py-2 text-sm text-slate-500">No users found.</p>}
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
