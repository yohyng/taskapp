import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seedOutlineDocument } from '../src/outline-model.js';
import { loroCheckpoint, restoreLoroCheckpoint, loroNode, loroViewRows } from '../src/loro-model.js';
import { collectLoroBackup, readLoroBackup } from '../src/loro-backup.js';
import { planLoroRecovery, restoreOutlineBackup } from '../src/restore-outline-backup.js';
import { restoreLoroJournal } from '../src/loro-journal.js';
import { outlineHandoffKey } from '../src/commit-outline-handoff.js';
import { outlineNodes } from '../src/outline-model.js';

const storage = { length: 0 };
function fixture() {
  const scope = { ownerId: randomUUID(), docId: randomUUID() };
  const initial = seedOutlineDocument([{ id: 'a', text: '基準の行', children: [] }, { id: 'b', text: '別の行', children: [] }]);
  const first = loroCheckpoint(initial); initial.free();
  const current = restoreLoroCheckpoint(first), remote = restoreLoroCheckpoint(first);
  function edit(doc, id, text) {
    let entry; const stop = doc.subscribeLocalUpdates((bytes) => { entry = { id: randomUUID(), bytes }; });
    loroNode(doc, id).data.get('text').insert(0, text); doc.commit(); stop(); return entry;
  }
  const a = edit(current, 'a', '端末の未送信：'), b = edit(remote, 'b', '控えの未送信：');
  const saved = { base: { ...first, format: 2, generation: 1, cutoff: 0 }, updates: [{ sequence: 1, bytes: a.bytes }], outbox: [a], cursor: 3, archives: [] };
  const other = { base: { ...loroCheckpoint(remote), format: 2, generation: 1, cutoff: 0 }, updates: [], outbox: [b], cursor: 8, archives: [] };
  const source = JSON.stringify(collectLoroBackup(storage, other, scope));
  return { scope, current, remote, saved, source, a, b, close() { current.free(); remote.free(); } };
}

test('復元の計画：端末と控えの未送信を同じ履歴へ合流し、古い取得位置を飛ばさない', () => {
  const f = fixture(), backup = readLoroBackup(f.source, f.scope);
  try {
    const before = structuredClone(f.saved), plan = planLoroRecovery(f.saved, backup);
    const merged = restoreLoroJournal({ ...f.saved, updates: [...f.saved.updates, ...plan.updates.map((bytes, index) => ({ sequence: index + 2, bytes }))] });
    try {
      assert.equal(loroNode(merged, 'a').data.get('text').toString(), '端末の未送信：基準の行');
      assert.equal(loroNode(merged, 'b').data.get('text').toString(), '控えの未送信：別の行');
      assert.deepEqual(plan.outgoing, [f.b]); assert.equal(plan.cursor, 3); assert.deepEqual(f.saved, before);
      assert.deepEqual(merged.getTree('outline').getNodes().map((node) => node.id), f.current.getTree('outline').getNodes().map((node) => node.id));
    } finally { merged.free(); }
    const empty = { base: { snapshot: null, pending: null, generation: 0, cutoff: 0, format: 2 }, updates: [], outbox: [], cursor: -1, archives: [] };
    assert.equal(planLoroRecovery(empty, backup).cursor, 8);
  } finally { backup.doc.free(); f.close(); }
});

test('復元の計画：同じ送信IDの違う内容・別履歴の重複行・異なる移行世代を拒む', () => {
  const f = fixture(), backup = readLoroBackup(f.source, f.scope);
  try {
    assert.throws(() => planLoroRecovery({ ...f.saved, outbox: [{ ...f.a, id: f.b.id }] }, backup), /違う内容/);
    const foreign = seedOutlineDocument([{ id: 'a', text: '別履歴の行', children: [] }]);
    try { assert.throws(() => planLoroRecovery(f.saved, { ...backup, snapshot: loroCheckpoint(foreign).snapshot }), /別の履歴/); } finally { foreign.free(); }
    assert.throws(() => planLoroRecovery({ ...f.saved, archives: [{ key: 'cutover', value: { migrationId: 'one' } }] },
      { ...backup, archives: [{ key: 'cutover', value: { migrationId: 'two' } }] }), /移行世代/);
    assert.deepEqual(planLoroRecovery({ ...f.saved, outbox: [f.a, f.b] }, backup).outgoing, []);
  } finally { backup.doc.free(); f.close(); }
});

test('復元の開始：所有者・保存先・切替の記録が不正なら端末保存を開かない', async () => {
  const f = fixture(); let opened = 0;
  const options = { ...f.scope, source: f.source, storageId: `owner:${f.scope.ownerId}:${f.scope.docId}`, activeOwner: () => f.scope.ownerId,
    openStorage: async () => { opened++; throw new Error('開く前に拒否される必要がある'); } };
  try {
    await assert.rejects(restoreOutlineBackup({ ...options, activeOwner: () => randomUUID() }), /所有者/);
    await assert.rejects(restoreOutlineBackup({ ...options, storageId: 'wrong' }), /所有者/);
    const payload = JSON.parse(f.source);
    payload.outlineSync.archives.push({ key: 'cutover', value: { ...f.scope, phase: 'complete', migrationId: randomUUID() } });
    await assert.rejects(restoreOutlineBackup({ ...options, source: JSON.stringify(payload) }), /切替完了/);
    assert.equal(opened, 0);
  } finally { f.close(); }
});

test('復元の保存：原文と復元前の姿を保存へ渡し、同じ控えの再実行は編集を作らない', async () => {
  const f = fixture(); let receipt, calls = 0, closes = 0;
  const options = { ...f.scope, source: f.source, storageId: `owner:${f.scope.ownerId}:${f.scope.docId}`, activeOwner: () => f.scope.ownerId,
    openStorage: async () => ({ readRecovery: async () => receipt ?? null, read: async () => structuredClone(f.saved), close() { closes++; },
      async commitRecovery(value) { calls++; assert.equal(value.active(), true); receipt = value.receipt; assert.deepEqual(value.expected, f.saved); return true; } }) };
  try {
    const first = await restoreOutlineBackup(options); assert.equal(first.applied, true);
    assert.equal(receipt.source, f.source); assert.deepEqual(receipt.before, f.saved);
    assert.deepEqual(await restoreOutlineBackup(options), { applied: false, key: first.key }); assert.equal(calls, 1); assert.equal(closes, 2);
    receipt.source = '壊れた原文'; await assert.rejects(restoreOutlineBackup(options), /復元記録/); assert.equal(calls, 1);
  } finally { f.close(); }
});

test('復元の保存：読み出し途中のログアウトと保存失敗では確定せず、保存を閉じる', async () => {
  const f = fixture(); let owner = f.scope.ownerId, calls = 0, closes = 0;
  const options = { ...f.scope, source: f.source, storageId: `owner:${f.scope.ownerId}:${f.scope.docId}`, activeOwner: () => owner,
    openStorage: async () => ({ readRecovery: async () => null, read: async () => { owner = null; return structuredClone(f.saved); },
      async commitRecovery() { calls++; }, close() { closes++; } }) };
  try {
    await assert.rejects(restoreOutlineBackup(options), /所有者/); assert.equal(calls, 0); assert.equal(closes, 1);
    owner = f.scope.ownerId;
    options.openStorage = async () => ({ readRecovery: async () => null, read: async () => structuredClone(f.saved), close() { closes++; },
      async commitRecovery() { calls++; throw new Error('保存を中止'); } });
    await assert.rejects(restoreOutlineBackup(options), /保存を中止/); assert.equal(closes, 2);
    assert.equal(loroViewRows(f.current)[0].text, '端末の未送信：基準の行');
  } finally { f.close(); }
});

test('復元の開始：完了した切替原本と処理済み印を一緒に引き継ぎ、欠けた組合せは適用しない', async () => {
  const f = fixture(), payload = JSON.parse(f.source);
  try {
    const checkpoint = { format: 'taskspace-outline/1', revision: 1, at: '2026-11-05', nodes: outlineNodes(loroViewRows(f.remote)), complete: true,
      sync: { sequence: 0, pending: [], known: ['a', 'b'], deleted: [] } };
    const key = await outlineHandoffKey(checkpoint), handoff = { format: 1, key, ...f.scope, archive: checkpoint, retained: [] };
    payload.outlineSync.archives = [{ key: 'cutover', value: { format: 1, ...f.scope, phase: 'complete', migrationId: randomUUID(), checkpoint, handoffKey: key } },
      { key: `handoff:${key}`, value: handoff }];
    let committed;
    const options = { ...f.scope, source: JSON.stringify(payload), storageId: `owner:${f.scope.ownerId}:${f.scope.docId}`, activeOwner: () => f.scope.ownerId,
      openStorage: async () => ({ readRecovery: async () => null, read: async () => structuredClone(f.saved), close() {},
        async commitRecovery(value) { committed = value; return true; } }) };
    assert.equal((await restoreOutlineBackup(options)).applied, true); assert.deepEqual(committed.archives, payload.outlineSync.archives);
    payload.outlineSync.archives.pop(); await assert.rejects(restoreOutlineBackup({ ...options, source: JSON.stringify(payload) }), /切替完了/);
  } finally { f.close(); }
});
