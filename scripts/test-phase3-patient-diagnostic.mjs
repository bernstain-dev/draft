import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localTestDatabase } from './local-test-db.mjs';

// Synthetic disposable loopback database only; never reads .env or hosted data.
const db = await localTestDatabase();
try {
  const migration = readFileSync('supabase/fix_phase3_notifications_reports.sql', 'utf8');
  const start = migration.indexOf('create or replace function public._valid_clinic_text');
  const end = migration.indexOf('do $$ declare n bigint;', start);
  assert.ok(start >= 0 && end > start);
  db.sql(migration.slice(start, end));
  db.sql(`create table public.patients(full_name text, contact_number text, address text, date_of_birth date);
    insert into public.patients values
      ('Synthetic',null,null,null),
      ('Synthetic','09123456789','Synthetic',date '2000-01-01'),
      ('Synthetic','',null,null),
      ('Synthetic','   ',null,null),
      ('Synthetic','not-a-phone',null,null),
      (' ',null,null,null),
      (E'Synthetic\\nName',null,null,null),
      ('Synthetic',null,repeat('x',501),null),
      ('Synthetic',null,null,(now() at time zone 'Asia/Manila')::date+1),
      ('Synthetic',null,null,date '1899-12-31'),
      ('Synthetic',null,null,date 'infinity');`);
  const before = db.sql('select jsonb_agg(to_jsonb(p)) from public.patients p;').stdout;
  const diagnostic = readFileSync('supabase/diagnose_phase3_patient_validation.sql', 'utf8');
  const expected = db.sql(`select count(*) from public.patients where not public._valid_clinic_text(full_name,300,true)
    or not public._valid_clinic_contact(contact_number) or not public._valid_clinic_text(address,500)
    or (date_of_birth is not null and (not isfinite(date_of_birth) or date_of_birth < date '1900-01-01'
      or date_of_birth > (now() at time zone 'Asia/Manila')::date));`).stdout.trim();
  const counts = db.sql(diagnostic).stdout.trim().split('|').map(Number);
  assert.equal(counts[0], Number(expected));
  assert.deepEqual(counts, [9,2,3,2,1,1,3]);
  assert.equal(db.sql('select jsonb_agg(to_jsonb(p)) from public.patients p;').stdout, before);
  db.sql('truncate public.patients;'); // Disposable synthetic fixture only.
  assert.deepEqual(db.sql(diagnostic).stdout.trim().split('|').map(Number), [0,0,0,0,0,0,0]);
  console.log('PASS Diagnostic matches Phase 3 rules, distinguishes blank/nonblank contacts, handles empty data, returns only counts, and leaves fixture records unchanged. No hosted database contacted.');
} finally {
  db.close();
}
