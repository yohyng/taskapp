import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoroDoc, LoroText, UndoManager } from 'loro-crdt';
import { fixtureLoroDocument, loroNode, loroViewRows } from '../src/loro-model.js';
import { createLoroProjection } from '../src/loro-projection.js';

function watch(doc) {
  const projection = createLoroProjection(doc), stop = doc.subscribe(projection.apply);
  return { projection, close() { stop(); doc.free(); } };
}
const equal = (doc, projection) => assert.deepEqual(projection.snapshot(), loroViewRows(doc));

test('一万行でも本文と属性は変更行だけを読み、以前の表示世代を保持する', () => {
  const doc = fixtureLoroDocument(10000), { projection, close } = watch(doc);
  try {
    const before = projection.snapshot(), stats = projection.stats();
    loroNode(doc, 'row-0').data.get('text').insert(0, '追記：'); doc.commit();
    loroNode(doc, 'row-9999').data.get('text').insert(0, '末尾：'); doc.commit();
    const data = loroNode(doc, 'row-3').data;
    data.set('favorite', true); data.set('completed', true); data.set('deleted', true); doc.commit();
    equal(doc, projection);
    assert.equal(projection.stats().fullRebuilds, stats.fullRebuilds);
    assert.equal(projection.stats().incrementalRowReads - stats.incrementalRowReads, 3);
    assert.equal(before.find((row) => row.id === 'row-0').text, '最初のメモ');
    assert.equal(before.find((row) => row.id === 'row-5000'), projection.snapshot().find((row) => row.id === 'row-5000'));
    assert.throws(() => { projection.snapshot()[0].text = '表示から原本を壊さない'; });
  } finally { close(); }
});

test('二行の本文と属性を同時に受信しても各行一回の読出しで正規の表示と一致する', () => {
  const doc = fixtureLoroDocument(), remote = doc.fork(), { projection, close } = watch(doc);
  try {
    const from = doc.oplogVersion();
    try {
      loroNode(remote, 'row-0').data.get('text').insert(0, '受信0：');
      loroNode(remote, 'row-3').data.get('text').insert(0, '受信3：');
      loroNode(remote, 'row-0').data.set('favorite', true); remote.commit();
      const stats = projection.stats(); doc.import(remote.export({ mode: 'update', from }));
      equal(doc, projection);
      assert.equal(projection.stats().fullRebuilds, stats.fullRebuilds);
      assert.equal(projection.stats().incrementalRowReads - stats.incrementalRowReads, 2);
    } finally { from.free(); }
  } finally { remote.free(); close(); }
});

test('枝の移動・作成・素の削除とUndoでは索引と並び順を再構築する', () => {
  const doc = fixtureLoroDocument(), { projection, close } = watch(doc), undo = new UndoManager(doc, { mergeInterval: 0 });
  try {
    const stats = projection.stats();
    loroNode(doc, 'row-1').move(loroNode(doc, 'row-2')); doc.commit(); equal(doc, projection);
    const node = doc.getTree('outline').createNode(); node.data.set('id', 'new');
    node.data.setContainer('text', new LoroText()).insert(0, '追加'); doc.commit(); equal(doc, projection);
    doc.getTree('outline').delete(node.id); doc.commit(); equal(doc, projection);
    undo.undo(); equal(doc, projection);
    assert.ok(projection.stats().fullRebuilds >= stats.fullRebuilds + 4);
    assert.equal(projection.nativeIds().length, projection.snapshot().length);
  } finally { undo.free(); close(); }
});

test('本文コンテナーやIDの置換は再索引し、その後の本文を取りこぼさない', () => {
  const doc = fixtureLoroDocument(), { projection, close } = watch(doc);
  try {
    const node = loroNode(doc, 'row-0'), stats = projection.stats();
    node.data.setContainer('text', new LoroText()).insert(0, '新しい本文'); doc.commit(); equal(doc, projection);
    node.data.set('id', 'renamed'); doc.commit(); equal(doc, projection);
    assert.equal(projection.stats().fullRebuilds, stats.fullRebuilds + 2);
    const ready = projection.stats();
    projection.node('renamed').data.get('text').insert(0, '続き：'); doc.commit(); equal(doc, projection);
    assert.equal(projection.stats().fullRebuilds, ready.fullRebuilds);
    assert.equal(projection.stats().incrementalRowReads, ready.incrementalRowReads + 1);
    assert.throws(() => projection.node('row-0'));
  } finally { close(); }
});

test('本文・削除印のUndoとRedoも別端末の属性を保って表示へ反映する', () => {
  const doc = fixtureLoroDocument(), remote = doc.fork(), { projection, close } = watch(doc), undo = new UndoManager(doc, { mergeInterval: 0 });
  try {
    loroNode(doc, 'row-0').data.get('text').insert(0, '自分：'); doc.commit(); equal(doc, projection);
    loroNode(remote, 'row-0').data.set('favorite', true); remote.commit();
    doc.import(remote.export({ mode: 'update' })); equal(doc, projection);
    undo.undo(); equal(doc, projection); assert.equal(projection.snapshot().find((row) => row.id === 'row-0').favorite, true);
    undo.redo(); equal(doc, projection);
    loroNode(doc, 'row-0').data.set('deleted', true); doc.commit(); equal(doc, projection);
    undo.undo(); equal(doc, projection);
    assert.equal(projection.stats().fullRebuilds, 1);
  } finally { undo.free(); remote.free(); close(); }
});

test('未適用の受信と未知のイベントでも空の表示で成功扱いせず正規の結果を読む', () => {
  const source = fixtureLoroDocument(), doc = new LoroDoc(), { projection, close } = watch(doc);
  const from = source.oplogVersion(), base = source.export({ mode: 'snapshot' });
  try {
    loroNode(source, 'row-0').data.get('text').insert(0, '先に届く：'); source.commit();
    doc.import(source.export({ mode: 'update', from })); equal(doc, projection);
    doc.import(base); equal(doc, projection);
    assert.equal(projection.snapshot().length, 30);
    const before = projection.stats();
    doc.getMap('unknown').set('other', true); doc.commit(); equal(doc, projection);
    assert.ok(projection.stats().fullRebuilds > before.fullRebuilds);
  } finally { from.free(); source.free(); close(); }
});
