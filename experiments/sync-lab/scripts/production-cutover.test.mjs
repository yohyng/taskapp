import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { productionIdHash, productionOutline, productionFreezeSql, productionActivation } from './production-cutover.mjs';
import { flattenTree } from '../../../src/lib/outline.js';

const row = (id, parent_id = null, sort_order = 0) => ({ id, parent_id, sort_order, text: "日本語🌿と引用' $$ \\ 画像 ![](https://example.test/image)",
  collapsed: false, completed: true, favorite: true, date: '2026-11-06', heading_level: 2, text_color: 'red', bg_color: null,
  image_width: 321, created_at: '2026-11-06T00:00:00+00:00', updated_at: '2026-11-06T00:00:00.123456+00:00' });
function fixture(rows = [row('parent'), row('child', 'parent')]) {
  const manifest = { format: 1, kind: 'production-cutover', projectRef: 'eiyzlawmcyybchxzyozr',
    documentId: randomUUID(), migrationId: randomUUID(), rows: rows.length, sourceIdSha256: productionIdHash(rows) };
  const receipt = { phase: 'preparing', migration_id: manifest.migrationId, doc_id: manifest.documentId, owner_id: randomUUID(), row_count: rows.length };
  return { rows, manifest, receipt };
}
test('本番原本：全属性・マイクロ秒・画像幅・親子と相対順序を保持し、同じIDの履歴を一つだけ生成する', () => {
  const rows = [row('parent'), row('later', 'parent', 100), row('earlier', 'parent', -1)], f = fixture(rows);
  const result = productionActivation(f.manifest, f.receipt, rows), flat = flattenTree(result.nodes);
  assert.equal(result.snapshot.length > 0, true); assert.equal(flat.length, 3);
  assert.deepEqual(result.nodes[0].children.map((node) => node.id), ['earlier', 'later']);
  assert.equal(flat[1].updatedAt, rows[2].updated_at); assert.equal(flat[1].imageWidth, 321); assert.equal(flat[1].completed, true);
  assert.equal(result.manifest.documentId, f.manifest.documentId); assert.equal(result.manifest.ownerId, f.receipt.owner_id);
  assert.match(result.sql, /production_original/); assert.doesNotMatch(result.sql, /delete from|truncate|on conflict/i);
});
test('本番原本：空・重複・親不在・循環・未知の列を、補修や空への置換をせず拒む', () => {
  for (const rows of [[], [row('a'), row('a')], [row('a', 'missing')], [row('a', 'b'), row('b', 'a')], [{ ...row('a'), unknown: '落とせない属性' }]]) {
    assert.throws(() => productionOutline(rows));
  }
  const rows = [row('日本語'), row('a')]; assert.equal(productionIdHash(rows), productionIdHash([...rows].reverse()));
});
test('本番切替：検証先・違う停止結果・欠けた全行を拒み、本文をSQL文字列として安全に保全する', async () => {
  const f = fixture();
  await assert.rejects(productionFreezeSql({ ...f.manifest, projectRef: 'wtshrgsmqavcytjmqjft' }));
  for (const change of [{ phase: 'active' }, { owner_id: 'not-uuid' }, { doc_id: randomUUID() }, { row_count: 1 }]) {
    assert.throws(() => productionActivation(f.manifest, { ...f.receipt, ...change }, f.rows));
  }
  assert.throws(() => productionActivation(f.manifest, f.receipt, f.rows.slice(0, 1)));
  const quoted = [{ ...row('a'), text: "引用'と$$と改行\nを保つ" }], next = fixture(quoted);
  assert.match(productionActivation(next.manifest, next.receipt, quoted).sql, /引用''と\$\$と改行/);
});
test('本番SQLの実DB：取り違え・所有者曖昧は全体を戻し、停止原本から一度だけ有効化する', { skip: process.env.LAB_PRODUCTION_SQL !== '1' }, async () => {
  const uri = process.env.LAB_SOURCE_URI || 'postgresql://lab:lab-only-password@127.0.0.1:5434/lab_source', target = new URL(uri);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.pathname === '/lab_source');
  const pool = new pg.Pool({ connectionString: uri }), client = await pool.connect(), f = fixture(), other = randomUUID();
  const rejected = async (sql, pattern) => { try { await assert.rejects(client.query(sql), pattern); } finally { await client.query('rollback'); } };
  try {
    await client.query(`create role authenticated nologin; create role anon nologin; create schema auth;
      create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
      create table public.outline_nodes(id text primary key, parent_id text, sort_order double precision, text text, collapsed boolean,
        completed boolean, favorite boolean, date text, heading_level integer, text_color text, bg_color text, image_width double precision,
        created_at timestamptz, updated_at timestamptz);
      grant select, insert, update, delete on public.outline_nodes to authenticated;`);
    await client.query('insert into auth.users values($1),($2)', [f.receipt.owner_id, other]);
    await client.query('insert into public.outline_nodes select * from jsonb_populate_recordset(null::public.outline_nodes,$1::jsonb)', [JSON.stringify(f.rows)]);
    await rejected(await productionFreezeSql({ ...f.manifest, sourceIdSha256: '0'.repeat(64) }), /行ID/);
    await rejected(await productionFreezeSql(f.manifest), /所有者/);
    assert.equal((await client.query("select to_regclass('public.taskspace_loro_documents') as value")).rows[0].value, null);
    await client.query('delete from auth.users where id=$1', [other]);
    await client.query(await productionFreezeSql(f.manifest));
    assert.equal((await client.query('select phase from taskspace_loro.legacy_cutover')).rows[0].phase, 'preparing');
    assert.equal((await client.query('select jsonb_array_length(rows) as count from taskspace_loro.production_original')).rows[0].count, 2);
    await rejected("update public.outline_nodes set text='古い端末からの保存'", /停止/);
    const rows = (await client.query('select to_jsonb(n) as data from public.outline_nodes n order by id collate "C"')).rows.map((r) => r.data);
    const wrong = rows.map((r) => ({ ...r, text: '別の原本' }));
    await rejected(productionActivation(f.manifest, f.receipt, wrong).sql, /原本/);
    assert.equal((await client.query('select count(*)::integer as count from public.taskspace_loro_documents')).rows[0].count, 0);
    const activation = productionActivation(f.manifest, f.receipt, rows); await client.query(activation.sql);
    assert.equal((await client.query('select phase from taskspace_loro.legacy_cutover')).rows[0].phase, 'active');
    await rejected(activation.sql, /一致/);
    assert.equal((await client.query('select count(*)::integer as count from public.taskspace_loro_documents')).rows[0].count, 1);
    await client.query('set role authenticated'); await client.query("select set_config('request.jwt.claim.sub',$1,false)", [f.receipt.owner_id]);
    assert.equal((await client.query('select public.taskspace_loro_cutover_route() as route')).rows[0].route.docId, f.manifest.documentId);
    await assert.rejects(client.query('select * from taskspace_loro.production_original'), /permission denied/);
    await client.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    await assert.rejects(client.query('select public.taskspace_loro_cutover_route()'), /停止/);
  } finally { await client.query('reset role'); client.release(); await pool.end(); }
});
