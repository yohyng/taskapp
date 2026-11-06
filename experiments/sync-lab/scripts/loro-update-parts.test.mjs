import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoroDoc, LoroText, UndoManager } from 'loro-crdt';
import { fixtureLoroDocument, loroNode, loroViewRows, loroRows } from '../src/loro-model.js';
import { prepareLogEntry, splitLoroUpdate, LOG_UPDATE_BYTES } from '../src/loro-update-parts.js';
import { logBatch } from '../src/loro-log-transfer.js';
import { largeText } from '../tests/support/large-text.mjs';
import { createLoroProjection } from '../src/loro-projection.js';

test('長文：元の操作IDを保って分割し、逆順の受信と重複からも全文・木・属性を復元する', () => {
  const doc = fixtureLoroDocument(), baseline = doc.export({ mode: 'snapshot' }), received = new LoroDoc(), text = largeText(400000);
  let original; const stop = doc.subscribeLocalUpdates((bytes) => { original = bytes; });
  try {
    loroNode(doc, 'row-0').data.get('text').insert(0, text); loroNode(doc, 'row-1').data.set('favorite', true); doc.commit();
    assert.ok(original.length > 1024 * 1024);
    const from = doc.oplogVersion(), parts = splitLoroUpdate(doc, original);
    try { assert.deepEqual([...doc.oplogVersion().encode()], [...from.encode()]); } finally { from.free(); }
    assert.ok(parts.length > 1); assert.ok(parts.every((part) => part.length <= LOG_UPDATE_BYTES));
    for (const bytes of [...parts].reverse()) { received.import(bytes); received.import(bytes); }
    assert.ok(received.exportPendingUpdates()?.length); received.import(baseline);
    assert.deepEqual(loroViewRows(received), loroViewRows(doc));
    assert.deepEqual(loroRows(received), loroRows(doc));
    assert.deepEqual([...received.oplogVersion().encode()], [...doc.oplogVersion().encode()]);
    assert.equal(loroNode(received, 'row-0').data.get('text').toString(), text + '最初のメモ');
  } finally { stop(); received.free(); doc.free(); }
});

test('長文：一操作自体が大きい非本文属性は、分割で消したり別の値へ作り直したりしない', () => {
  const doc = new LoroDoc(); let original; const stop = doc.subscribeLocalUpdates((bytes) => { original = bytes; });
  try {
    const value = largeText(); doc.getMap('attributes').set('value', value); doc.commit();
    assert.throws(() => splitLoroUpdate(doc, original), /分割できない大きな属性/);
    assert.equal(doc.getMap('attributes').get('value'), value);
  } finally { stop(); doc.free(); }
});

test('長文：分割の境界が行の作成途中でも未完成の空行を表示せず、再読込後の続きで同じ行になる', () => {
  const doc = fixtureLoroDocument(), received = new LoroDoc(); received.import(doc.export({ mode: 'snapshot' }));
  const projection = createLoroProjection(received), stopProjection = received.subscribe(projection.apply);
  let original; const stop = doc.subscribeLocalUpdates((bytes) => { original = bytes; });
  try {
    loroNode(doc, 'row-0').data.get('text').insert(0, '文'.repeat(16383));
    const made = doc.getTree('outline').createNode(); made.data.set('id', 'pasted-row');
    made.data.setContainer('text', new LoroText()).insert(0, '字'.repeat(30000)); doc.commit();
    const parts = splitLoroUpdate(doc, original); received.import(parts[0]);
    assert.equal(received.getTree('outline').getNodes().length, 31);
    assert.equal(projection.snapshot().length, 30); assert.ok(projection.snapshot().every((row) => typeof row.id === 'string'));
    const reopened = new LoroDoc();
    try {
      reopened.import(received.export({ mode: 'snapshot' }));
      for (const bytes of parts.slice(1)) { received.import(bytes); reopened.import(bytes); }
      assert.deepEqual(projection.snapshot(), loroViewRows(doc)); assert.deepEqual(loroRows(reopened), loroRows(doc));
    } finally { reopened.free(); }
  } finally { stop(); stopProjection(); received.free(); doc.free(); }
});

test('長文：分割を書き出しても貼り付けは一回のUndoで戻り、別端末の追記を消さない', () => {
  const doc = fixtureLoroDocument(), remote = doc.fork(), from = doc.oplogVersion(), undo = new UndoManager(doc, { mergeInterval: 0 });
  let original; const stop = doc.subscribeLocalUpdates((bytes) => { original = bytes; });
  try {
    const text = largeText(); loroNode(doc, 'row-0').data.get('text').insert(0, text); doc.commit();
    const parts = splitLoroUpdate(doc, original); for (const bytes of parts) remote.import(bytes);
    loroNode(remote, 'row-0').data.get('text').insert(loroNode(remote, 'row-0').data.get('text').length, '・別端末'); remote.commit();
    doc.import(remote.export({ mode: 'update', from })); undo.undo();
    assert.equal(loroNode(doc, 'row-0').data.get('text').toString(), '最初のメモ・別端末');
    undo.redo(); assert.equal(loroNode(doc, 'row-0').data.get('text').toString(), text + '最初のメモ・別端末');
  } finally { stop(); undo.free(); from.free(); remote.free(); doc.free(); }
});

test('長文：小さい編集をそのまま送り、大きい後続の前まで進め、分割先のIDを一意にする', () => {
  const doc = fixtureLoroDocument(); let bytes; const stop = doc.subscribeLocalUpdates((value) => { bytes = value; });
  try {
    const small = { id: crypto.randomUUID(), bytes: new Uint8Array([1, 2]) };
    assert.equal(prepareLogEntry(small, doc), null); assert.equal(prepareLogEntry(undefined, doc), null);
    loroNode(doc, 'row-0').data.get('text').insert(0, largeText()); doc.commit();
    const large = { id: crypto.randomUUID(), bytes }, parts = prepareLogEntry(large, doc);
    assert.deepEqual(logBatch([small, large]), [small]);
    assert.equal(new Set(parts.map((part) => part.id)).size, parts.length);
    assert.ok(parts.every((part) => part.id !== large.id));
    const corrupt = bytes.slice(); corrupt[20] ^= 1; assert.throws(() => splitLoroUpdate(doc, corrupt));
  } finally { stop(); doc.free(); }
});
