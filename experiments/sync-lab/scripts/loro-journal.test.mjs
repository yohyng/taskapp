import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureLoroDocument, loroCheckpoint, loroNode, loroViewRows } from '../src/loro-model.js';
import { checkpointLoroJournal, restoreLoroJournal } from '../src/loro-journal.js';

const empty = () => ({ base: { snapshot: null, pending: null }, updates: [], outbox: [] });
function edit(doc, value) {
  let bytes; const stop = doc.subscribeLocalUpdates((update) => { bytes = update.slice(); });
  try { loroNode(doc, 'row-0').data.get('text').insert(0, value); doc.commit(); return bytes; } finally { stop(); }
}

test('空の差分記録は合成文書を勝手に作らない', () => {
  const doc = restoreLoroJournal(empty());
  try { assert.deepEqual(loroViewRows(doc), []); } finally { doc.free(); }
});

test('一万行の小さい差分を再生し、まとめ直しても本文・属性・木・ネイティブIDを保つ', () => {
  const source = fixtureLoroDocument(10000), saved = empty();
  try {
    saved.base = loroCheckpoint(source);
    const bytes = edit(source, '一文字：'); saved.updates.push({ sequence: 1, bytes });
    assert.ok(bytes.length < 1024); assert.ok(saved.base.snapshot.length > bytes.length * 100);
    const from = source.oplogVersion();
    try {
      loroNode(source, 'row-9999').data.set('favorite', true);
      loroNode(source, 'row-3').move(loroNode(source, 'row-2')); source.commit();
      saved.updates.push({ sequence: 2, bytes: source.export({ mode: 'update', from }) });
    } finally { from.free(); }
    saved.outbox = [{ id: '未確認', bytes }];
    const compacted = checkpointLoroJournal(saved), restored = restoreLoroJournal({ ...saved, base: compacted, updates: [] });
    try {
      assert.deepEqual(loroViewRows(restored), loroViewRows(source));
      assert.deepEqual(restored.getTree('outline').getNodes().map((node) => node.id), source.getTree('outline').getNodes().map((node) => node.id));
      assert.equal(saved.outbox[0].id, '未確認'); assert.equal(saved.updates.length, 2);
    } finally { restored.free(); }
  } finally { source.free(); }
});

test('前提より先に届いた受信はまとめ直し後も残り、前提が届くと全内容を復元する', () => {
  const source = fixtureLoroDocument(), saved = empty();
  try {
    saved.base = loroCheckpoint(source);
    const first = edit(source, '先行：'), second = edit(source, '後続：');
    saved.updates = [{ sequence: 1, bytes: second }];
    const compacted = checkpointLoroJournal(saved); assert.ok(compacted.pending?.length);
    const restored = restoreLoroJournal({ ...saved, base: compacted, updates: [{ sequence: 2, bytes: first }] });
    try { assert.deepEqual(loroViewRows(restored), loroViewRows(source)); assert.equal(restored.exportPendingUpdates(), undefined); }
    finally { restored.free(); }
  } finally { source.free(); }
});

test('同じ受信の再送は重複せず、壊れた差分から空の成功結果へ戻さない', () => {
  const source = fixtureLoroDocument(), saved = empty();
  try {
    const bytes = source.export({ mode: 'update' });
    saved.updates = [{ sequence: 1, bytes }, { sequence: 2, bytes }];
    const restored = restoreLoroJournal(saved);
    try { assert.deepEqual(loroViewRows(restored), loroViewRows(source)); } finally { restored.free(); }
    saved.updates.push({ sequence: 3, bytes: new Uint8Array([1, 2, 3]) });
    assert.throws(() => restoreLoroJournal(saved)); assert.throws(() => checkpointLoroJournal(saved));
    assert.equal(saved.updates.length, 3);
  } finally { source.free(); }
});
