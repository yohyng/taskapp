import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function postgresLog() {
  const uri = process.env.LAB_SOURCE_URI || 'postgresql://lab:lab-only-password@127.0.0.1:5434/lab_source';
  const target = new URL(uri);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/lab_source') throw new Error('使い捨てのローカルDBだけを利用できます');
  const pool = new pg.Pool({ connectionString: uri });
  const admin = await pool.connect(); let initialized = false;
  try {
    await admin.query('begin'); await admin.query('select pg_advisory_xact_lock(731003)');
    await admin.query(`do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
      do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;`);
    await admin.query(await readFile(new URL('../../infra/loro-log.sql', import.meta.url), 'utf8'));
    await admin.query('commit'); initialized = true;
  } catch (error) { await admin.query('rollback'); throw error; }
  finally { admin.release(); if (!initialized) await pool.end(); }
  async function transaction(ownerId, action, role = 'authenticated') {
    const client = await pool.connect();
    try {
      await client.query('begin'); await client.query(`set local role ${role === 'anon' ? 'anon' : 'authenticated'}`);
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId || '']);
      const result = await action(client); await client.query('commit'); return result;
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  const call = (client, docId, cursor, updates) => client.query('select public.taskspace_loro_exchange($1,$2,$3) as result', [docId, cursor, JSON.stringify(updates)]).then((result) => result.rows[0].result);
  return {
    pool, transaction, call,
    exchange: (ownerId, docId, cursor = -1, updates = []) => transaction(ownerId, (client) => call(client, docId, cursor, updates)),
    async seed(ownerId, snapshot) {
      const id = randomUUID(), client = await pool.connect();
      try {
        await client.query('begin'); await client.query('insert into public.taskspace_loro_documents(id, owner_id) values($1,$2)', [id, ownerId]);
        await client.query('insert into taskspace_loro.snapshots values($1,$2)', [id, Buffer.from(snapshot)]); await client.query('commit'); return id;
      } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}
