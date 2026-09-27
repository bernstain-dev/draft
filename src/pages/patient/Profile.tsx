import { useEffect, useState } from 'react';
import { getPatientClient, usePatientAuth } from './auth/patientAuth';
import { useTheme } from '../../lib/theme';

export default function PatientProfile({ showSettings = false }: { showSettings?: boolean }) {
  const sb = getPatientClient();
  const { user, profile, patient, refreshPatient } = usePatientAuth();
  const { theme, setTheme } = useTheme();
  const [form, setForm] = useState({ full_name: '', contact_number: '', date_of_birth: '', address: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({
      full_name: patient?.full_name ?? profile?.full_name ?? '',
      contact_number: patient?.contact_number ?? '',
      date_of_birth: patient?.date_of_birth ?? '',
      address: patient?.address ?? '',
    });
  }, [patient, profile]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!patient || !user) {
      setMsg("We couldn't save your profile right now. Please try again.");
      return;
    }
    if (!form.full_name.trim()) {
      setMsg('Please enter your full name.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const payload = {
        full_name: form.full_name.trim(),
        contact_number: form.contact_number.trim() || null,
        date_of_birth: form.date_of_birth || null,
        address: form.address.trim() || null,
      };
      const { error } = await sb.from('patients').update(payload).eq('id', patient.id);
      if (error) {
        setMsg(`We couldn't save your profile right now. (${error.message})`);
        return;
      }
      try {
        await sb.from('profiles').update({ full_name: form.full_name.trim() }).eq('id', user.id);
      } catch {
        // display-name sync is best-effort (depends on RLS update policy)
      }
      await refreshPatient();
      setMsg('Your profile has been updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{showSettings ? 'Settings' : 'Profile'}</h1>
        <p className="text-sm text-slate-400">
          {showSettings ? 'Manage your appearance and session.' : 'Keep your contact details up to date.'}
        </p>
      </div>

      {showSettings ? (
        <div className="dk-panel max-w-lg space-y-3">
          <h2 className="font-semibold">Appearance</h2>
          <div className="flex gap-2">
            <button
              type="button"
              className={theme === 'light' ? 'dk-btn-primary' : 'dk-btn-ghost'}
              onClick={() => setTheme('light')}
            >
              Light
            </button>
            <button
              type="button"
              className={theme === 'dark' ? 'dk-btn-primary' : 'dk-btn-ghost'}
              onClick={() => setTheme('dark')}
            >
              Dark
            </button>
          </div>
          <div className="border-t border-white/5 pt-3 text-sm text-slate-400">
            <p>Signed in as <span className="font-semibold text-slate-200">{user?.email ?? '—'}</span></p>
          </div>
        </div>
      ) : (
        <form onSubmit={save} className="dk-panel max-w-lg space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Full name</label>
            <input
              className="dk-input"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="Juan Dela Cruz"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Email</label>
            <input className="dk-input opacity-60" value={user?.email ?? ''} disabled readOnly />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Contact number</label>
              <input
                className="dk-input"
                value={form.contact_number}
                onChange={(e) => setForm({ ...form, contact_number: e.target.value })}
                placeholder="09xx xxx xxxx"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Date of birth</label>
              <input
                className="dk-input"
                type="date"
                value={form.date_of_birth}
                onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Address</label>
            <textarea
              className="dk-input"
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Street, barangay, municipality"
            />
          </div>
          {msg && <p role="status" className="text-sm text-slate-300">{msg}</p>}
          <button type="submit" className="dk-btn-primary w-full py-2.5" disabled={busy}>
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      )}
    </div>
  );
}
