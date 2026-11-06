import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoroDoc, LoroText, UndoManager } from 'loro-crdt';
import { fixtureLoroDocument, loroNode, loroRows, loroCheckpoint, restoreLoroCheckpoint } from '../src/loro-model.js';
import { analyzeTree } from '../src/tree-model.js';

const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const edit = (doc, action) => { action(); doc.commit({ origin: 'この端末の編集' }); };
const state = (doc) => analyzeTree(loroRows(doc));
const ids = (doc) => loroRows(doc).map((row) => [row.id, row.nativeId]).sort();
function replicas(use) {
  const seed = fixtureLoroDocument(), bytes = seed.export({ mode: 'snapshot' }); seed.free();
  const docs = [2, 3, 4].map((peer) => { const doc = new LoroDoc(); doc.setPeerId(String(peer)); doc.import(bytes); return doc; });
  try { return use(docs); } finally { for (const doc of docs) doc.free(); }
}
function exchange(docs, order = [0, 1, 2]) {
  // 送信順・重複の条件を固定する。各端末の操作を受信前に採り、受信が別の送信内容を変えない。
  const updates = docs.map((doc) => doc.export({ mode: 'update' }));
  for (const [i, doc] of docs.entries()) for (const index of [...order.slice(i), ...order.slice(0, i), order[0]]) doc.import(updates[index]);
  const expected = loroRows(docs[0]);
  for (const doc of docs) {
    assert.deepEqual(loroRows(doc), expected);
    assert.deepEqual(state(doc).issues, { cycles: [], missingParents: [] });
    assert.equal(new Set(expected.map((row) => row.id)).size, expected.length);
    assert.equal(state(doc).visible.length + state(doc).trash.length, expected.length);
  }
}
function markDeleted(doc, id, value) { edit(doc, () => loroNode(doc, id).data.set('deleted', value)); }
function append(doc, id, value) { edit(doc, () => { const text = loroNode(doc, id).data.get('text'); text.insert(text.length, value); }); }

for (const [index, order] of orders.entries()) test(`Loro：相互移動を順序${index + 1}で重複受信しても循環せず、全行を通常表示に残す`, () => replicas((docs) => {
  const before = ids(docs[0]);
  edit(docs[0], () => loroNode(docs[0], 'row-1').move(loroNode(docs[0], 'row-2')));
  edit(docs[1], () => loroNode(docs[1], 'row-2').move(loroNode(docs[1], 'row-1')));
  exchange(docs, order);
  for (const doc of docs) { assert.equal(state(doc).visible.length, 30); assert.deepEqual(ids(doc), before); }
}));

test('Loro：三つの枝の循環候補も、三端末と異なる受信順で同じ木になる', () => {
  for (const order of orders) replicas((docs) => {
    for (const [i, id, parent] of [[0, 'row-1', 'row-2'], [1, 'row-2', 'row-10'], [2, 'row-10', 'row-1']]) edit(docs[i], () => loroNode(docs[i], id).move(loroNode(docs[i], parent)));
    exchange(docs, order);
    assert.equal(state(docs[0]).visible.length, 30);
  });
});

test('Loro：枝の移動のUndoとRedoは別端末の本文と属性を保ち、IDを作り直さない', () => replicas((docs) => {
  const [a, b] = docs, before = ids(a), undo = new UndoManager(a, { mergeInterval: 0 });
  try {
    edit(a, () => loroNode(a, 'row-1').move(loroNode(a, 'row-2')));
    append(b, 'row-3', '・別端末の追記');
    edit(b, () => loroNode(b, 'row-1').data.set('favorite', true));
    exchange(docs); assert.equal(undo.undo(), true); exchange(docs);
    assert.equal(loroNode(a, 'row-1').parent(), undefined);
    assert.equal(loroNode(a, 'row-1').data.get('favorite'), true);
    assert.match(loroNode(a, 'row-3').data.get('text').toString(), /別端末の追記/);
    assert.deepEqual(ids(a), before);
    assert.equal(undo.redo(), true); exchange(docs);
    assert.equal(loroNode(a, 'row-1').parent().data.get('id'), 'row-2');
    assert.deepEqual(ids(a), before);
  } finally { undo.free(); }
}));

test('Loro：削除印だけをUndoすると、削除中の追記を同じIDの枝へ戻せる', () => replicas((docs) => {
  const [a, b] = docs, before = ids(a), undo = new UndoManager(a, { mergeInterval: 0 });
  try {
    markDeleted(a, 'row-1', true); append(b, 'row-3', '・削除を知らなかった追記'); exchange(docs);
    assert.equal(state(a).visible.length, 22);
    assert.match(state(a).trash.find((row) => row.id === 'row-3').text, /削除を知らなかった追記/);
    assert.equal(undo.undo(), true); exchange(docs);
    assert.equal(state(a).visible.length, 30); assert.deepEqual(ids(a), before);
    assert.match(state(a).visible.find((row) => row.id === 'row-3').text, /削除を知らなかった追記/);
    assert.equal(undo.redo(), true); exchange(docs);
    assert.equal(state(a).visible.length, 22); assert.deepEqual(ids(a), before);
  } finally { undo.free(); }
}));

test('Loro：素のTree削除のUndoはノードを再作成し、削除中の追記が復元表示へ戻らないケースを再現する', () => replicas((docs) => {
  const [a, b] = docs, old = loroNode(a, 'row-1'), oldChild = loroNode(a, 'row-3');
  const undo = new UndoManager(a, { mergeInterval: 0 });
  try {
    edit(a, () => a.getTree('outline').delete(old.id));
    append(b, 'row-3', '・削除中の追記'); exchange(docs);
    assert.equal(oldChild.isDeleted(), true);
    assert.match(oldChild.data.get('text').toString(), /削除中の追記/);
    assert.equal(undo.undo(), true); exchange(docs);
    // 旧本文は削除側に残るが、作り直された表示上の枝は削除時点の写しになる。UXの合格ではない。
    assert.notEqual(loroNode(a, 'row-3').id, oldChild.id);
    assert.equal(loroNode(a, 'row-3').data.get('text').toString(), '検証用の行 3');
    assert.match(oldChild.data.get('text').toString(), /削除中の追記/);
    assert.equal(a.getTree('outline').getNodes({ withDeleted: true }).length, 38);
  } finally { undo.free(); }
}));

test('Loro：削除する親の外へ移した子は、親の削除印に巻き込まれない', () => replicas((docs) => {
  markDeleted(docs[0], 'row-1', true);
  edit(docs[1], () => loroNode(docs[1], 'row-3').move()); exchange(docs);
  assert.equal(state(docs[0]).visible.length, 23);
  assert.equal(loroNode(docs[0], 'row-3').parent(), undefined);
}));

test('Loro：削除済みと知らずにその親へ移すと枝は削除済み欄へ入り、木専用型だけではUXが解決しない', () => replicas((docs) => {
  markDeleted(docs[0], 'row-2', true);
  edit(docs[1], () => loroNode(docs[1], 'row-1').move(loroNode(docs[1], 'row-2')));
  append(docs[1], 'row-3', '・移動中の追記'); exchange(docs);
  assert.equal(state(docs[0]).visible.length, 21);
  assert.match(state(docs[0]).trash.find((row) => row.id === 'row-3').text, /移動中の追記/);
  assert.equal(loroRows(docs[0]).length, 30);
}));

test('Loro：同じ枝の二つの移動は一方の位置へ収束し、子と本文を複製しない', () => replicas((docs) => {
  const before = ids(docs[0]);
  edit(docs[0], () => loroNode(docs[0], 'row-1').move(loroNode(docs[0], 'row-2'), 0));
  edit(docs[1], () => loroNode(docs[1], 'row-1').move(loroNode(docs[1], 'row-10'), 0)); exchange(docs);
  assert.ok(['row-2', 'row-10'].includes(loroNode(docs[0], 'row-1').parent().data.get('id')));
  assert.equal(loroNode(docs[0], 'row-3').parent().data.get('id'), 'row-1');
  assert.deepEqual(ids(docs[0]), before);
}));

test('Loro：兄弟の同じ場所への並べ替えも全端末で同じ順序になる', () => replicas((docs) => {
  edit(docs[0], () => loroNode(docs[0], 'row-3').moveAfter(loroNode(docs[0], 'row-6')));
  edit(docs[1], () => loroNode(docs[1], 'row-4').moveAfter(loroNode(docs[1], 'row-6'))); exchange(docs);
  const children = loroNode(docs[0], 'row-1').children();
  assert.equal(children.length, 7);
  assert.ok(children.findIndex((node) => node.data.get('id') === 'row-3') > children.findIndex((node) => node.data.get('id') === 'row-6'));
  assert.ok(children.findIndex((node) => node.data.get('id') === 'row-4') > children.findIndex((node) => node.data.get('id') === 'row-6'));
}));

test('Loro：自分自身や子孫への移動をライブラリーの操作で拒否する', () => replicas(([doc]) => {
  const before = loroRows(doc);
  assert.throws(() => loroNode(doc, 'row-1').move(loroNode(doc, 'row-1')));
  assert.throws(() => loroNode(doc, 'row-1').move(loroNode(doc, 'row-3')));
  assert.deepEqual(loroRows(doc), before);
}));

test('Loro：古い未編集の写しは最新を受け取るだけで、独自の操作を発行しない', () => replicas((docs) => {
  const a = docs[0], localUpdates = [], stop = a.subscribeLocalUpdates((bytes) => localUpdates.push(bytes));
  try {
    markDeleted(docs[1], 'row-1', true); append(docs[1], 'row-0', '・最新'); exchange(docs);
    const saved = loroCheckpoint(a), restored = restoreLoroCheckpoint(structuredClone(saved));
    try { assert.deepEqual(loroRows(restored), loroRows(a)); assert.equal(state(restored).visible.length, 22); }
    finally { restored.free(); }
    assert.equal(localUpdates.length, 0);
  } finally { stop(); }
}));

test('Loro：圏外の追記をバイナリから読み直し、別端末の属性へ重ねる', () => replicas((docs) => {
  const [a, b, c] = docs, before = ids(a);
  append(a, 'row-3', '・圏外で保存');
  const restored = restoreLoroCheckpoint(structuredClone(loroCheckpoint(a)));
  try {
    edit(b, () => loroNode(b, 'row-3').data.set('favorite', true)); exchange([restored, b, c]);
    assert.match(loroNode(c, 'row-3').data.get('text').toString(), /圏外で保存/);
    assert.equal(loroNode(c, 'row-3').data.get('favorite'), true); assert.deepEqual(ids(c), before);
  } finally { restored.free(); }
}));

test('Loro：同じ保存から開いた二つの文書は別のpeerで編集し、片方のUndoで他方の追記を消さない', () => replicas(([source, observer]) => {
  const saved = loroCheckpoint(source), a = restoreLoroCheckpoint(saved), b = restoreLoroCheckpoint(saved);
  const undo = new UndoManager(a, { mergeInterval: 0 });
  try {
    assert.notEqual(a.peerIdStr, b.peerIdStr); assert.notEqual(a.peerIdStr, source.peerIdStr);
    edit(a, () => loroNode(a, 'row-0').data.get('text').insert(0, '復帰A・'));
    append(b, 'row-0', '・復帰B'); exchange([a, b, observer]);
    assert.equal(loroNode(observer, 'row-0').data.get('text').toString(), '復帰A・最初のメモ・復帰B');
    assert.equal(undo.undo(), true); exchange([a, b, observer]);
    assert.equal(loroNode(observer, 'row-0').data.get('text').toString(), '最初のメモ・復帰B');
  } finally { undo.free(); a.free(); b.free(); }
}));

test('Loro：本文の先頭と末尾の追記を統合し、自分のUndoで別端末の追記を戻さない', () => replicas((docs) => {
  const [a, b] = docs, undo = new UndoManager(a, { mergeInterval: 0 });
  try {
    edit(a, () => loroNode(a, 'row-0').data.get('text').insert(0, '先頭・'));
    append(b, 'row-0', '・末尾'); exchange(docs);
    assert.equal(loroNode(a, 'row-0').data.get('text').toString(), '先頭・最初のメモ・末尾');
    assert.equal(undo.undo(), true); exchange(docs);
    assert.equal(loroNode(a, 'row-0').data.get('text').toString(), '最初のメモ・末尾');
  } finally { undo.free(); }
}));

test('Loro：先行する枝の作成を待つ受信更新は、snapshotと未適用バイナリを一緒に復元する', () => replicas(([source, receiver]) => {
  const from = source.oplogVersion();
  edit(source, () => {
    const node = loroNode(source, 'row-1').createNode();
    node.data.set('id', 'new-row'); node.data.setContainer('text', new LoroText()).insert(0, '作成');
  });
  const first = source.export({ mode: 'update', from }), afterFirst = source.oplogVersion();
  append(source, 'new-row', '・後から届く本文');
  const second = source.export({ mode: 'update', from: afterFirst });
  const result = receiver.import(second);
  assert.ok(result.pending instanceof Map && result.pending.size > 0);
  const saved = loroCheckpoint(receiver);
  assert.ok(saved.pending instanceof Uint8Array);
  const snapshotOnly = restoreLoroCheckpoint({ snapshot: saved.snapshot, pending: null });
  const restored = restoreLoroCheckpoint(structuredClone(saved));
  try {
    snapshotOnly.import(first);
    assert.equal(loroNode(snapshotOnly, 'new-row').data.get('text').toString(), '作成');
    assert.ok(restored.exportPendingUpdates() instanceof Uint8Array);
    restored.import(first); restored.import(second);
    assert.equal(loroNode(restored, 'new-row').data.get('text').toString(), '作成・後から届く本文');
    assert.equal(loroCheckpoint(restored).pending, null);
    assert.deepEqual(loroRows(restored), loroRows(source));
  } finally { snapshotOnly.free(); restored.free(); }
}));

test('Loro：壊れた保存バイナリを空の文書として成功扱いしない', () => replicas(([doc]) => {
  const broken = structuredClone(loroCheckpoint(doc));
  broken.snapshot[Math.floor(broken.snapshot.length / 2)] ^= 1;
  assert.throws(() => restoreLoroCheckpoint(broken));
}));

test('Loro：固定した16系列の合法な移動を全6受信順で交換しても、30行の木を保つ', () => {
  for (let seed = 1; seed <= 16; seed++) for (const order of orders) replicas((docs) => {
    let random = seed;
    const next = (n) => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n; };
    for (const doc of docs) for (let turn = 0; turn < 10; turn++) {
      const rows = loroRows(doc), byId = new Map(rows.map((row) => [row.id, row]));
      const id = rows[next(rows.length)].id, parent = next(4) ? rows[next(rows.length)].id : null;
      let valid = true;
      for (let cursor = parent; cursor !== null; cursor = byId.get(cursor).parentId) if (cursor === id) { valid = false; break; }
      if (valid) edit(doc, () => loroNode(doc, id).move(parent === null ? undefined : loroNode(doc, parent), 0));
    }
    exchange(docs, order); assert.equal(state(docs[0]).visible.length, 30);
  });
});
