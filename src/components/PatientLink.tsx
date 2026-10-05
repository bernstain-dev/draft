import { Link as LinkIcon } from 'lucide-react';
import AppIcon from './AppIcon';
import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Patient } from '../lib/types';
import { validUuid } from '../lib/formValidation';
import { useMutation } from '../lib/useMutation';
export default function PatientLink({ patient, client, onLinked }: { patient: Patient; client: SupabaseClient; onLinked: () => void }) {
  const [identity, setIdentity] = useState(''), [verified, setVerified] = useState(false), [message, setMessage] = useState<string | null>(null);
  const mutation = useMutation(setMessage);
  async function link(e: React.FormEvent) {
    e.preventDefault();
    if (!validUuid(identity.trim())) { setMessage('Enter the exact verified Supabase Auth user UUID.'); return; }
    if (!verified) { setMessage('Verify the person and their Auth account before linking.'); return; }
    if (!confirm(`Link clinic patient ${patient.full_name} (${patient.id}) to Auth identity ${identity.trim()}? No history merging is performed.`)) return;
    await mutation.run(async () => {
      const { data, error } = await client.rpc('admin_link_patient', { p_user_id: identity.trim(), p_patient_id: patient.id });
      if (error) { setMessage(error.message); return; }
      if (!data?.success || data.id !== patient.id) { setMessage('Link could not be confirmed. No success was reported.'); return; }
      setMessage('Intentional identity link saved.'); setVerified(false); onLinked();
    });
  }
  return <form className="dk-panel space-y-2" onSubmit={link}>
    <h3 className="font-semibold">Link clinic patient: {patient.full_name}</h3>
    <p className="text-xs">Patient UUID: {patient.id} · DOB: {patient.date_of_birth ?? 'not recorded'}</p>
    <p className="text-sm">Use the exact Auth identity after verifying the person outside the app. Names are never matched automatically. Existing histories are not merged. A conflicting link is rejected.</p>
    <input className="dk-input" aria-label="Verified Auth UUID" value={identity} onChange={e => { setIdentity(e.target.value); setVerified(false); }} placeholder="Exact Auth user UUID" maxLength={36} disabled={mutation.pending} />
    <label className="block"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} disabled={mutation.pending} /> I verified the person and this exact Auth account.</label>
    {message && <p role="status">{message}</p>}
    <button className="icon-button dk-btn-primary" type="submit" disabled={mutation.pending || !verified}><AppIcon icon={LinkIcon} size={17} />{mutation.pending ? 'Linking…' : 'Confirm identity link'}</button>
  </form>;
}
