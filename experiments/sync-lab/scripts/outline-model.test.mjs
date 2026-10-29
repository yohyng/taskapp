import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UndoManager } from 'loro-crdt';
import { seedOutlineDocument, applyOutlineIntent, outlineNodes } from '../src/outline-model.js';
import { loroViewRows } from '../src/loro-model.js';
const original = [{ id: 'a', text: '本文', collapsed: true, favorite: true, completed: false, date: '2026-10-28', headingLevel: 2,
  textColor: '#00ff00', bgColor: '#111111', imageWidth: 640, createdAt: '2026-10-01', updatedAt: '2026-10-02',
  children: [{ id: 'image', text: '![](https://example.test/image.png)', children: [] }] }, { id: 'b', text: '別行', children: [] }];
const nodes = (doc) => outlineNodes(loroViewRows(doc));

test('本体の形：ID・本文・画像参照・表示属性・日時・親子を保持し、開いただけでは差分を作らない', () => {
  const doc = seedOutlineDocument(original), updates = [], stop = doc.subscribeLocalUpdates((bytes) => updates.push(bytes));
  try {
    const restored = nodes(doc); assert.equal(restored[0].imageWidth, 640); assert.equal(restored[0].children[0].text, original[0].children[0].text);
    for (const key of ['text', 'date', 'headingLevel', 'createdAt', 'updatedAt', 'collapsed', 'favorite', 'textColor', 'bgColor']) assert.equal(restored[0][key], original[0][key]);
    applyOutlineIntent(doc, restored, structuredClone(restored)); doc.commit(); assert.equal(updates.length, 0);
    assert.throws(() => seedOutlineDocument([original[0], original[0]]), /行ID/);
  } finally { stop(); doc.free(); }
});

test('本体の形：別端末の同じ本文への追記と色変更を統合し、ローカルUndoで受信を消さない', () => {
  const a = seedOutlineDocument(original), b = a.fork(), undo = new UndoManager(a, { mergeInterval: 0 }), from = a.oplogVersion();
  try {
    const before = nodes(a), changed = structuredClone(before); changed[0].text += '・PC';
    applyOutlineIntent(a, before, changed); a.commit();
    const other = nodes(b), after = structuredClone(other); after[0].text = 'スマホ・' + after[0].text; after[0].textColor = '#0000ff';
    applyOutlineIntent(b, other, after); b.commit();
    a.import(b.export({ mode: 'update', from })); b.import(a.export({ mode: 'update', from })); assert.deepEqual(nodes(a), nodes(b));
    assert.equal(nodes(a)[0].text, 'スマホ・本文・PC'); assert.equal(nodes(a)[0].textColor, '#0000ff');
    undo.undo(); assert.equal(nodes(a)[0].text, 'スマホ・本文'); assert.equal(nodes(a)[0].textColor, '#0000ff');
  } finally { from.free(); undo.free(); a.free(); b.free(); }
});

test('本体の形：枝の削除と遠隔の追記を保ち、Undoで同じIDの枝が戻る', () => {
  const a = seedOutlineDocument(original), b = a.fork(), undo = new UndoManager(a, { mergeInterval: 0 }), from = a.oplogVersion();
  try {
    applyOutlineIntent(a, nodes(a), [nodes(a)[1]]); a.commit();
    const before = nodes(b), after = structuredClone(before); after[0].children[0].text += '・遠隔';
    applyOutlineIntent(b, before, after); b.commit(); a.import(b.export({ mode: 'update', from }));
    assert.equal(nodes(a).length, 1); undo.undo(); assert.equal(nodes(a)[0].children[0].id, 'image'); assert.match(nodes(a)[0].children[0].text, /遠隔$/);
  } finally { from.free(); undo.free(); a.free(); b.free(); }
});

test('本体の形：新しい親への追加・移動・並び替えを同じ木に適用する', () => {
  const doc = seedOutlineDocument(original);
  try {
    const before = nodes(doc), after = [{ id: 'new', text: '親', children: [before[1], { id: 'new-child', text: '子', children: [] }] }, before[0]];
    applyOutlineIntent(doc, before, after); doc.commit();
    assert.deepEqual(nodes(doc).map((node) => node.id), ['new', 'a']);
    assert.deepEqual(nodes(doc)[0].children.map((node) => node.id), ['b', 'new-child']);
  } finally { doc.free(); }
});

test('本体の形：削除印の兄弟が残っていても、間への追加で表示順を入れ替えない', () => {
  const doc = seedOutlineDocument(['hidden', 'a', 'b'].map((id) => ({ id, text: id, children: [] })));
  try {
    applyOutlineIntent(doc, nodes(doc), nodes(doc).slice(1)); doc.commit();
    const before = nodes(doc), after = [before[0], { id: 'between', text: '間に追加', children: [] }, before[1]];
    applyOutlineIntent(doc, before, after); doc.commit();
    assert.deepEqual(nodes(doc).map((node) => node.id), ['a', 'between', 'b']);
  } finally { doc.free(); }
});
