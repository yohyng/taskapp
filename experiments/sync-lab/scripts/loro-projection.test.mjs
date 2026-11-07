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


test('構造変更：一万行の改行・インデントでも不変の本文を再利用し、同時に届く追記と色は読み直す', () => {
  const doc = fixtureLoroDocument(10000), { projection, close } = watch(doc), remote = doc.fork();
  try {
    const before = projection.snapshot(), stats = projection.stats();
    const parent = projection.node('row-1'), node = doc.getTree('outline').createNode(parent.id);
    node.data.set('id', '追加行'); node.data.setContainer('text', new LoroText()).insert(0, '改行');
    projection.node('row-0').data.get('text').insert(0, '同時入力：'); doc.commit(); equal(doc, projection);
    assert.ok(projection.stats().cachedRowReads - stats.cachedRowReads >= 9999);
    assert.equal(projection.stats().fullRowReads - stats.fullRowReads, 2);
    assert.equal(before.find((row) => row.id === 'row-0').text, '最初のメモ');
    const from = doc.oplogVersion();
    try {
      loroNode(remote, 'row-2').move(loroNode(remote, 'row-1'));
      loroNode(remote, 'row-9999').data.get('text').insert(0, '遠隔：');
      loroNode(remote, 'row-0').data.set('textColor', '#00ff00'); remote.commit();
      doc.import(remote.export({ mode: 'update', from })); equal(doc, projection);
      assert.equal(projection.snapshot().find((row) => row.id === 'row-0').textColor, '#00ff00');
      assert.match(projection.snapshot().find((row) => row.id === 'row-9999').text, /^遠隔：/);
    } finally { from.free(); }
  } finally { remote.free(); close(); }
});


test('構造の再利用：作成途中の親は子ごと待ち、本文コンテナー置換と移動も取りこぼさない', () => {
  const doc = fixtureLoroDocument(), { projection, close } = watch(doc), undo = new UndoManager(doc, { mergeInterval: 0 });
  try {
    const parent = doc.getTree('outline').createNode(); parent.data.set('id', '途中の親'); doc.commit(); equal(doc, projection);
    const child = parent.createNode(); child.data.set('id', '途中の子'); child.data.setContainer('text', new LoroText()).insert(0, '子');
    doc.commit(); equal(doc, projection); assert.ok(!projection.snapshot().some((row) => row.id === '途中の子'));
    parent.data.setContainer('text', new LoroText()).insert(0, '親が到着');
    projection.node('row-0').move(parent); doc.commit(); equal(doc, projection);
    assert.ok(projection.snapshot().some((row) => row.id === '途中の子'));
    parent.data.setContainer('text', new LoroText()).insert(0, '本文を置換');
    parent.data.set('id', '置換した親'); child.move(undefined, 0); doc.commit(); equal(doc, projection);
    undo.undo(); equal(doc, projection); undo.redo(); equal(doc, projection);
    projection.node('置換した親').data.get('text').insert(0, '続き：'); doc.commit(); equal(doc, projection);
  } finally { undo.free(); close(); }
});
