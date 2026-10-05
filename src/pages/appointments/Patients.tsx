import { Link as LinkIcon, Pencil, Plus, Save, Search, X } from 'lucide-react';
import AppIcon from '../../components/AppIcon';
import { useClinicQuery } from '../../lib/useClinicQuery';
import { useEffect, useState } from 'react';
import { getStaffClient } from './auth/staffAuth';
import type { Patient } from '../../lib/types';
import { patientFormError } from '../../lib/formValidation';
import { useMutation } from '../../lib/useMutation';
import PatientLink from '../../components/PatientLink';
import QueryState from '../../components/QueryState';
import { clinicDateKey } from '../../lib/clinicTime';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default function Patients() {
  const sb = getStaffClient();
  const [qName, setQName] = useState('');
  const [qDob, setQDob] = useState('');
  const [qContact, setQContact] = useState('');
  const [searchSerial, setSearchSerial] = useState(1);
  const [searched, setSearched] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [form, setForm] = useState({ full_name: '', date_of_birth: '', contact_number: '', address: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const mutation = useMutation(setMsg);
  const [linking, setLinking] = useState<Patient | null>(null);
  const [createId, setCreateId] = useState(() => crypto.randomUUID());

  const filters = JSON.stringify([qName, qDob, qContact]);
  const [submittedFilters, setSubmittedFilters] = useState(filters);
  const list = useClinicQuery<Patient[]>(filters === submittedFilters ? `${filters}/${searchSerial}` : '', async (signal) => {
    let query = sb.from('patients').select('*').order('full_name').limit(50);
    if (qName.trim()) query = query.ilike('full_name', `%${qName.trim()}%`);
    if (qContact.trim()) query = query.ilike('contact_number', `%${qContact.trim()}%`);
    if (qDob) query = query.eq('date_of_birth', qDob);
    const { data, error } = await query.abortSignal(signal);
    if (error) throw new Error(error.message);
    return (data as Patient[]) ?? [];
  }, []);
  const results = list.data;
  function search() { setMsg(null); setSubmittedFilters(filters); setSearchSerial((s) => s + 1); setSearched(true); }

  function startCreate() {
    setCreateId(crypto.randomUUID());
    setEditing({ id: '', full_name: qName, date_of_birth: qDob || null, contact_number: qContact || null } as Patient);
    setForm({ full_name: qName, date_of_birth: qDob, contact_number: qContact, address: '' });
  }

  function startEdit(p: Patient) {
    setEditing(p);
    setForm({
      full_name: p.full_name,
      date_of_birth: p.date_of_birth ?? '',
      contact_number: p.contact_number ?? '',
      address: p.address ?? '',
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await mutation.run(async () => {
      setMsg(null);
      const validation = patientFormError(form);
      if (validation) { setMsg(validation); return; }
      // Complete server count is a review warning, never an identity/linking rule.
      if (!editing?.id) {
        const { data: duplicateCount, error } = await sb.rpc('admin_patient_duplicate_count', {
          p_name: form.full_name.trim(), p_dob: form.date_of_birth || null, p_contact: form.contact_number.trim() || null,
        });
        if (error) { setMsg(error.message); return; }
        if (Number(duplicateCount) > 0 && !confirm(`${duplicateCount} possible duplicate records share this name and DOB/contact. Reuse a verified record, or confirm this is a separate person. Create a separate record without merging history?`)) {
          setMsg('Creation stopped for duplicate review. Search and reuse the verified clinic record.'); return;
        }
      }
      const payload = {
        full_name: form.full_name.trim(),
        date_of_birth: form.date_of_birth || null,
        contact_number: form.contact_number.trim() || null,
        address: form.address.trim() || null,
      };
      if (editing?.id) {
        const { data, error } = await sb.from('patients').update(payload).eq('id', editing.id).select('id').single();
        if (error) setMsg(error.message);
        else if (data) {
          setEditing(null);
          void search();
          setMsg('Patient updated.');
        }
      } else {
        const { data, error } = await sb.from('patients').insert({ ...payload, id: createId }).select('id').single();
        if (error) setMsg(error.message);
        else if (data) {
          setEditing(null);
          void search();
          setMsg('Patient created.');
        }
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Patients</h1>
        <p className="text-sm text-slate-400">
          Search by name and date of birth or contact number before creating a new record.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
        <input className="dk-input" placeholder="Name" value={qName} onChange={(e) => setQName(e.target.value)} />
        <input className="dk-input" type="date" value={qDob} onChange={(e) => setQDob(e.target.value)} />
        <input className="dk-input" placeholder="Contact number" value={qContact} onChange={(e) => setQContact(e.target.value)} />
        <button disabled={mutation.pending} className="icon-button dk-btn-primary" onClick={() => void search()}><AppIcon icon={Search} size={17} />Search</button>
      </div>

      {(msg || list.error) && <p className="text-sm text-slate-300">{list.error || msg}</p>}
      <QueryState query={list} label="patients" />
      {linking && <div><PatientLink patient={linking} client={sb} onLinked={() => { search(); }} /><button disabled={mutation.pending} onClick={() => setLinking(null)} className="icon-button"><AppIcon icon={X} size={16} />Close identity linking</button></div>}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{filters !== submittedFilters ? 'Filters changed — press Search.' : searched ? `${results.length} results (first 50 matches; refine filters)` : 'First 50 records'}</p>
        <button disabled={mutation.pending} className="icon-button dk-btn-ghost" onClick={startCreate}><AppIcon icon={Plus} size={17} />New patient</button>
      </div>

      <div className="space-y-2">
        {results.map((p) => (
          <div key={p.id} className="dk-panel flex flex-wrap items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0e4a3a]/25 text-sm font-bold text-[#9fd8cb]">
              {initials(p.full_name)}
            </span>
            <div className="min-w-[140px] flex-1">
              <p className="truncate text-sm font-semibold">{p.full_name}</p>
              <p className="text-xs text-slate-500">
                Born {p.date_of_birth ?? '—'} · {p.contact_number ?? '—'}
              </p>
            </div>
            <button disabled={mutation.pending} className="icon-button dk-btn-ghost shrink-0" onClick={() => startEdit(p)}><AppIcon icon={Pencil} size={16} />Edit</button>
            <button className="icon-button dk-btn-ghost shrink-0" disabled={mutation.pending} onClick={() => setLinking(p)}><AppIcon icon={LinkIcon} size={16} />Link Auth identity</button>
          </div>
        ))}
        {searched && filters === submittedFilters && !list.loading && !list.error && results.length === 0 && (
          <div className="dk-panel"><p className="py-2 text-sm text-slate-500">No matches — you may create a new patient.</p></div>
        )}
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => { if (!mutation.pending) setEditing(null); }}
        >
          <form
            onSubmit={save}
            className="dk-panel w-full max-w-lg space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold">{editing.id ? 'Edit patient' : 'Create patient'}</h2>
            {msg && <p role="alert">{msg}</p>}
            <input className="dk-input" placeholder="Full name *" maxLength={300} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            <div className="grid gap-2 md:grid-cols-2">
              <input className="dk-input" type="date" min="1900-01-01" max={clinicDateKey()} value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
              <input className="dk-input" placeholder="Contact number" value={form.contact_number} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} />
            </div>
            <input className="dk-input" placeholder="Address" maxLength={500} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <div className="flex gap-2">
              <button disabled={mutation.pending} className="icon-button dk-btn-primary" type="submit"><AppIcon icon={Save} size={16} />Save</button>
              <button disabled={mutation.pending} className="icon-button dk-btn-ghost" type="button" onClick={() => { if (!mutation.pending) setEditing(null); }}><AppIcon icon={X} size={16} />Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
