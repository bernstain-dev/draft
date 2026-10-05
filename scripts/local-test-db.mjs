// Disposable loopback PostgreSQL only. Never reads project environment files.
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, sep } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
export async function localTestDatabase() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const locate = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['psql'], { encoding: 'utf8', windowsHide: true });
  const pgBin = process.env.PG_BIN || (locate.status === 0 ? dirname(locate.stdout.trim().split(/\r?\n/)[0]) : '');
  for (const name of ['initdb', 'pg_ctl', 'psql']) assert.ok(existsSync(join(pgBin, name + ext)), 'Local PostgreSQL required; no remote fallback.');
  const temporary = resolve(mkdtempSync(join(tmpdir(), 'medicappointment-phase3-'))), data = join(temporary, 'data');
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  const port = await new Promise((done, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)); }); });
  const run = (name, args, input) => spawnSync(join(pgBin, name + ext), args, { input, encoding: 'utf8', env: childEnv, windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  const args = db => ['-X','-h','127.0.0.1','-p',String(port),'-U','phase3_test_owner','-d',db,'-v','ON_ERROR_STOP=1','-Atq'];
  const sql = (text, db = 'phase3_test', allowError = false) => { const r = run('psql', args(db), text); if (!allowError && r.status !== 0) throw new Error(r.error?.message || r.stderr); return r; };
  const concurrent = (text, db = 'phase3_test') => new Promise((done, reject) => {
    const p = spawn(join(pgBin, 'psql' + ext), args(db), { env: childEnv, windowsHide: true }); let stdout = '', stderr = '';
    p.stdout.on('data', x => stdout += x); p.stderr.on('data', x => stderr += x); p.once('error', reject); p.once('exit', status => done({ status, stdout, stderr })); p.stdin.end(text);
  });
  let started = false;
  const close = () => {
    if (started) { const stopped = run('pg_ctl', ['-D',data,'-m','immediate','-w','stop']); assert.equal(stopped.status,0,stopped.stderr); started = false; }
    assert.ok(temporary.startsWith(resolve(tmpdir()) + sep)); assert.equal(dirname(data), temporary);
    rmSync(temporary, { recursive: true, force: true });
  };
  try {
    const init = run('initdb',['-D',data,'-U','phase3_test_owner','-A','trust','--no-sync','--encoding=UTF8']); assert.equal(init.status,0,init.stderr);
    const start = run('pg_ctl',['-D',data,'-l',join(temporary,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']); assert.equal(start.status,0,start.stderr); started = true;
    sql('create role anon; create role authenticated; create role service_role bypassrls;', 'postgres');
    sql('create database phase3_test;', 'postgres');
    sql(`create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,public to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;`);
    return { sql, concurrent, close, install: file => sql(readFileSync(file, 'utf8')) };
  } catch (error) { close(); throw error; }
}
