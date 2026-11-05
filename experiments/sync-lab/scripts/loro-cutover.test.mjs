import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { postgresLog } from '../tests/support/loro-postgres.mjs';
import { fixtureLoroDocument } from '../src/loro-model.js';

const sql = () => readFile(new URL('../infra/loro-cutover.sql', import.meta.url), 'utf8');
const oldTable = 'create table if not exists public.outline_nodes(id text primary key, text text); grant select, insert, update, delete, truncate on public.outline_nodes to authenticated;';

test('切替の実DB：停止前だけ旧書き込みを許可し、準備中・有効化後は旧版と他人の操作を拒む', { skip: process.env.LAB_POWERSYNC !== '1' }, async () => {
  const db = await postgresLog(), client = await db.pool.connect(), owner = randomUUID(), other = randomUUID(), docId = randomUUID(), migration = randomUUID(), seed = fixtureLoroDocument();
  async function as(user, command, parameters = []) {
    await client.query('savepoint access_check');
    try {
      await client.query('set local role authenticated'); await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      return await client.query(command, parameters);
    } finally { await client.query('rollback to savepoint access_check'); }
  }
  async function rejected(command, parameters, pattern) {
    await client.query('savepoint rejected_change');
    try { await assert.rejects(client.query(command, parameters), pattern); }
    finally { await client.query('rollback to savepoint rejected_change'); }
  }
  try {
    await client.query('begin'); await client.query(oldTable); await client.query(await sql());
    await as(owner, 'insert into public.outline_nodes values($1,$2)', [randomUUID(), '停止前']);
    await assert.rejects(as(owner, 'select public.taskspace_loro_cutover_route()'), /停止/);
    await assert.rejects(as(owner, 'update taskspace_loro.legacy_cutover set phase=\'active\''), /permission denied/);
    await client.query('select pg_advisory_xact_lock(1414745932,1)');
    await client.query("update taskspace_loro.legacy_cutover set phase='preparing', migration_id=$1,owner_id=$2,doc_id=$3", [migration, owner, docId]);
    for (const command of ["insert into public.outline_nodes values('late','遅延')", 'update public.outline_nodes set text=\'古い\'', 'delete from public.outline_nodes', 'truncate public.outline_nodes']) {
      await assert.rejects(as(owner, command), /停止/);
    }
    await rejected("update taskspace_loro.legacy_cutover set phase='active'", [], /原本/);
    await client.query('insert into public.taskspace_loro_documents(id,owner_id) values($1,$2)', [docId, owner]);
    await client.query('insert into taskspace_loro.snapshots values($1,$2)', [docId, Buffer.from(seed.export({ mode: 'snapshot' }))]);
    await client.query("update taskspace_loro.legacy_cutover set phase='active'");
    const route = (await as(owner, 'select public.taskspace_loro_cutover_route() route')).rows[0].route;
    assert.deepEqual(route, { format: 1, migrationId: migration, ownerId: owner, docId, legacyWritesBlocked: true });
    await assert.rejects(as(other, 'select public.taskspace_loro_cutover_route()'), /停止/);
    await rejected('delete from taskspace_loro.legacy_cutover', [], /切り戻し/);
    await rejected('update taskspace_loro.legacy_cutover set doc_id=$1', [randomUUID()], /別の文書/);
    await client.query(await sql());
    assert.equal((await as(owner, 'select public.taskspace_loro_cutover_route() route')).rows[0].route.migrationId, migration);
  } finally { await client.query('rollback'); client.release(); seed.free(); await db.close(); }
});

test('切替の実DB：停止前の書き込みを待って確定し、古いREPEATABLE READの写しも停止をすり抜けない', { skip: process.env.LAB_POWERSYNC !== '1' }, async () => {
  const db = await postgresLog(), setup = await db.pool.connect(), writer = await db.pool.connect(), reader = await db.pool.connect(), activation = await db.pool.connect();
  const migration = randomUUID(), owner = randomUUID(), docId = randomUUID(), id = randomUUID();
  let activating, installed = false;
  try {
    await setup.query(oldTable); await setup.query(await sql());
    installed = true;
    assert.equal((await setup.query('select phase from taskspace_loro.legacy_cutover')).rows[0].phase, 'idle');
    await writer.query('begin'); await writer.query('set local role authenticated');
    await writer.query('insert into public.outline_nodes values($1,$2)', [id, '停止直前']);
    await reader.query('begin isolation level repeatable read'); await reader.query('select * from public.outline_nodes');
    await activation.query('begin'); let finished = false;
    activating = (async () => {
      await activation.query('select pg_advisory_xact_lock(1414745932,1)');
      await activation.query("update taskspace_loro.legacy_cutover set phase='preparing',migration_id=$1,owner_id=$2,doc_id=$3", [migration, owner, docId]);
      await activation.query('commit'); finished = true;
    })();
    await new Promise((resolve) => setTimeout(resolve, 50)); assert.equal(finished, false);
    await writer.query('commit'); await activating;
    await assert.rejects(reader.query('update public.outline_nodes set text=\'古い写し\' where id=$1', [id]), /serialize|concurrent update/);
    await reader.query('rollback');
    await assert.rejects(db.transaction(owner, (client) => client.query('update public.outline_nodes set text=\'遅延\' where id=$1', [id])), /停止/);
    assert.equal((await setup.query('select text from public.outline_nodes where id=$1', [id])).rows[0].text, '停止直前');
  } finally {
    await writer.query('rollback'); await reader.query('rollback'); await activating?.catch(() => {}); await activation.query('rollback');
    // この使い捨て試験が登録した停止だけを片付ける。他の状態なら触らない。
    const current = installed ? await setup.query('select migration_id from taskspace_loro.legacy_cutover') : { rows: [] };
    if (current.rows[0]?.migration_id === migration) {
      await setup.query('begin'); await setup.query('select pg_advisory_xact_lock(1414745932,1)');
      await setup.query('truncate taskspace_loro.legacy_cutover'); await setup.query("insert into taskspace_loro.legacy_cutover(singleton,phase) values(true,'idle')"); await setup.query('commit');
      await setup.query('delete from public.outline_nodes where id=$1', [id]);
    }
    setup.release(); writer.release(); reader.release(); activation.release(); await db.close();
  }
});
