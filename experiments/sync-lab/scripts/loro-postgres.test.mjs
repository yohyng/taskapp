import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { postgresLog } from '../tests/support/loro-postgres.mjs';
import { fixtureLoroDocument } from '../src/loro-model.js';

test('実DB：所有者・権限・再送・原子的な追記・確定順・ページ取得を検査する', { skip: process.env.LAB_POWERSYNC !== '1' }, async () => {
  const db = await postgresLog(), owner = randomUUID(), other = randomUUID(), doc = fixtureLoroDocument();
  try {
    const id = await db.seed(owner, doc.export({ mode: 'snapshot' }));
    assert.equal((await db.exchange(owner, id)).head, 0);
    await assert.rejects(db.exchange(other, id), /文書を利用できません/);
    await assert.rejects(db.exchange(null, id), /ログインが必要/);
    await assert.rejects(db.transaction(owner, (client) => client.query('select public.taskspace_loro_exchange($1,-1,\'[]\')', [id]), 'anon'), /permission denied/);
    assert.equal((await db.transaction(other, (client) => client.query('select * from public.taskspace_loro_documents where id=$1', [id]))).rowCount, 0);
    await assert.rejects(db.transaction(owner, (client) => client.query('update public.taskspace_loro_documents set head=99 where id=$1', [id])), /permission denied/);
    await assert.rejects(db.transaction(owner, (client) => client.query('select * from taskspace_loro.updates')), /permission denied/);
    const operation = { id: randomUUID(), bytes: Buffer.from('差分1').toString('base64') };
    const result = await db.exchange(owner, id, 0, [operation]); assert.equal(result.head, 1);
    assert.deepEqual((await db.exchange(owner, id, 0, [operation])).acknowledged, [operation.id]);
    assert.equal((await db.exchange(owner, id, 0, [operation])).head, 1);
    await assert.rejects(db.exchange(owner, id, 0, [{ ...operation, bytes: Buffer.from('別内容').toString('base64') }]), /同じ操作ID/);
    // 後半が不正なら、先に挿入した前半も取引全体で戻る。
    await assert.rejects(db.exchange(owner, id, 0, [{ ...operation, id: randomUUID() }, { id: randomUUID(), bytes: '' }]), /送信量/);
    assert.equal((await db.exchange(owner, id)).head, 1);
    await assert.rejects(db.exchange(owner, id, 999), /取得位置/);
    const first = await db.pool.connect(), second = await db.pool.connect();
    try {
      await first.query('begin'); await first.query('set local role authenticated');
      await first.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      assert.equal((await db.call(first, id, 1, [{ ...operation, id: randomUUID() }])).head, 2);
      const waiting = second.query('select public.taskspace_loro_exchange($1,1,$2) result', [id, JSON.stringify([{ ...operation, id: randomUUID() }])]);
      // 管理接続にも本人を設定する。認証なしの関数呼出しにすり替わらないよう先に待機を検査する。
      await assert.rejects(waiting, /ログインが必要/);
      let settled = false;
      const later = db.exchange(owner, id, 1, [{ ...operation, id: randomUUID() }]).then((value) => { settled = true; return value; });
      await new Promise((resolve) => setTimeout(resolve, 50)); assert.equal(settled, false);
      await first.query('commit'); const final = await later;
      assert.equal(final.head, 3); assert.deepEqual(final.updates.map((entry) => entry.sequence), [2, 3]);
    } finally { await first.query('rollback'); first.release(); second.release(); }
    const entries = Array.from({ length: 70 }, () => ({ ...operation, id: randomUUID() }));
    for (let offset = 0; offset < entries.length; offset += 32) await db.exchange(owner, id, 3, entries.slice(offset, offset + 32));
    let cursor = 0, received = 0;
    while (cursor < 73) { const page = await db.exchange(owner, id, cursor); received += page.updates.length; cursor = page.cursor; }
    assert.equal(received, 73);
  } finally { doc.free(); await db.close(); }
});
