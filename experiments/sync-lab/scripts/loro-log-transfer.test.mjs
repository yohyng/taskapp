import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LoroDoc } from 'loro-crdt';
import { base64, decodeLogTransfer, logBatch } from '../src/loro-log-transfer.js';
import { fixtureLoroDocument, loroNode } from '../src/loro-model.js';
import { loroSupabaseTransport } from '../src/loro-supabase-transport.js';

test('差分ログ：snapshot・連番・操作ID・CRCが揃った応答だけを採り、抜けや偽のACKを拒む', () => {
  const doc = fixtureLoroDocument(), updates = [], stop = doc.subscribeLocalUpdates((bytes) => updates.push({ id: randomUUID(), bytes }));
  try {
    const snapshot = base64(doc.export({ mode: 'snapshot' }));
    loroNode(doc, 'row-0').data.get('text').insert(0, '差分：'); doc.commit();
    const result = { cursor: 1, head: 1, snapshot, updates: [{ sequence: 1, bytes: base64(updates[0].bytes) }], acknowledged: updates.map((entry) => entry.id) };
    const context = { cursor: -1, batch: updates };
    assert.equal(decodeLogTransfer(result, true, context).updates.length, 2);
    assert.throws(() => decodeLogTransfer({ ...result, acknowledged: [] }, true, context), /確認応答/);
    assert.throws(() => decodeLogTransfer({ ...result, updates: [{ ...result.updates[0], sequence: 2 }] }, true, context), /抜け/);
    assert.throws(() => decodeLogTransfer({ ...result, cursor: 0 }, true, context), /取得位置/);
    const corrupt = updates[0].bytes.slice(); corrupt[20] ^= 1;
    assert.throws(() => decodeLogTransfer({ ...result, updates: [{ sequence: 1, bytes: base64(corrupt) }] }, true, context));
    const restored = new LoroDoc();
    try { for (const bytes of decodeLogTransfer(result, true, context).updates) restored.import(bytes); assert.equal(loroNode(restored, 'row-0').data.get('text').toString(), '差分：最初のメモ'); }
    finally { restored.free(); }
  } finally { stop(); doc.free(); }
});

test('差分ログ：送信を件数とバイト数で小分けし、取得通知を受けてもSDKのACKにはしない', async () => {
  assert.equal(logBatch(Array.from({ length: 70 }, () => ({ bytes: new Uint8Array(20) }))).length, 32);
  assert.equal(logBatch(Array.from({ length: 8 }, () => ({ bytes: new Uint8Array(65536) }))).length, 4);
  assert.throws(() => logBatch([{ bytes: new Uint8Array(65537) }]), /送信上限/);
  let notify, status, removed = 0, signaled, parameters, calls = 0;
  const channel = { on(_kind, filter, callback) { assert.equal(filter.table, 'taskspace_loro_documents'); notify = callback; return this; }, subscribe(callback) { status = callback; return this; } };
  const transport = loroSupabaseTransport({ channel: () => channel, removeChannel: () => removed++, rpc(name, params) {
    calls++; assert.equal(name, 'taskspace_loro_exchange'); parameters = params;
    return { abortSignal(signal) { signaled = signal; return Promise.resolve({ data: '応答', error: null }); } };
  } });
  let wake = 0; const stop = transport.watch('文書', () => wake++); notify(); status('SUBSCRIBED'); assert.equal(wake, 2); assert.equal(calls, 0);
  const abort = new AbortController(); assert.equal(await transport.sync('文書', {}, abort.signal, { cursor: 4, batch: [] }), '応答');
  assert.deepEqual(parameters, { p_doc: '文書', p_cursor: 4, p_updates: [] }); assert.equal(signaled.aborted, false);
  stop(); assert.equal(removed, 1);
});

test('差分ログ：401の一回だけセッションを更新し、更新待ちに終了した文書は再送しない', async () => {
  let sends = 0, refreshes = 0;
  const client = { rpc() { sends++; return { abortSignal() { return Promise.resolve(sends === 1 ? { error: {}, status: 401 } : { data: '再開' }); } }; } };
  const transport = loroSupabaseTransport(client, { refreshSession: async () => { refreshes++; return true; } });
  assert.equal(await transport.sync('文書', {}, new AbortController().signal, { cursor: 0, batch: [] }), '再開');
  assert.equal(sends, 2); assert.equal(refreshes, 1);
  const abort = new AbortController(); sends = 0;
  const closing = loroSupabaseTransport(client, { refreshSession: async () => { abort.abort(); return true; } });
  await assert.rejects(closing.sync('文書', {}, abort.signal, { cursor: 0, batch: [] }), { name: 'AbortError' }); assert.equal(sends, 1);
});
