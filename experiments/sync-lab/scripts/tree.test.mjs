import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { fixtureDocument, snapshot } from '../src/model.js';
import { analyzeTree, movePlacement, mergeTreeCommand } from '../src/tree-model.js';

const rows = () => [
  { id: 'a', parentId: null, order: 0, deleted: false },
  { id: 'b', parentId: null, order: 1, deleted: false },
  { id: 'child', parentId: 'a', order: 0, deleted: false },
];
test('自分自身や子の下、存在しない親への移動を拒否する', () => {
  assert.throws(() => movePlacement(rows(), 'a', 'a'), /循環/);
  assert.throws(() => movePlacement(rows(), 'a', 'child'), /循環/);
  assert.throws(() => movePlacement(rows(), 'a', '不在'), /ありません/);
});
test('削除した親の子は保全し、親を戻すと同じIDのまま再表示できる', () => {
  const data = rows(); data[0].deleted = true;
  assert.deepEqual(analyzeTree(data).trash.map((row) => row.id), ['a', 'child']);
  data[0].deleted = false;
  assert.deepEqual(analyzeTree(data).visible.map((row) => row.id), ['a', 'child', 'b']);
});
test('削除した親から外へ移した子は、削除に巻き込まれない', () => {
  const data = rows(); data[0].deleted = true; data[2].parentId = 'b';
  assert.deepEqual(analyzeTree(data).visible.map((row) => row.id), ['b', 'child']);
});
test('欠けた親と循環を診断しても元のデータを書き換えない', () => {
  const data = rows(); data[0].parentId = 'b'; data[1].parentId = 'a';
  data.push({ id: '孤立', parentId: '不在', order: 3, deleted: false });
  const before = JSON.stringify(data), state = analyzeTree(data);
  assert.deepEqual(state.issues.cycles, [['a', 'b']]);
  assert.deepEqual(state.issues.missingParents, [{ id: '孤立', parentId: '不在' }]);
  assert.equal(state.detached.length, 4);
  assert.equal(JSON.stringify(data), before);
});
test('深い枝でも再帰の上限で表示処理が落ちない', () => {
  const data = Array.from({ length: 12000 }, (_, i) => ({ id: `n${i}`, parentId: i ? `n${i - 1}` : null, order: i, deleted: false }));
  assert.equal(analyzeTree(data).visible.at(-1).depth, 11999);
});
test('同じ並び順でもIDで決まり、入力配列の順に依存しない', () => {
  const data = rows(); data[1].order = 0;
  assert.deepEqual(analyzeTree(data).visible, analyzeTree(data.toReversed()).visible);
});
test('DB側では先に確定した移動と循環する要求を反映せず、意図を残す', () => {
  const data = rows(); data[0].parentId = 'b'; data[0].order = 2;
  const result = mergeTreeCommand(data, 'b', { kind: 'tree-move', before: { parentId: null, order: 1 }, after: { parentId: 'a', order: 3 } }, { parent_id: 'a', sort_order: 3 });
  assert.deepEqual(result.changes, {});
  assert.equal(result.conflicts[0].theirs.reason, 'cycle');
  assert.deepEqual(result.conflicts[0].mine, { parentId: 'a', order: 3 });
});
test('古い移動位置からの上書きを断り、同じ結果の再送は増やさない', () => {
  const data = rows(); data[0].parentId = 'b'; data[0].order = 2;
  const command = { kind: 'tree-move', before: { parentId: null, order: 0 }, after: { parentId: null, order: 3 } };
  assert.equal(mergeTreeCommand(data, 'a', command, { parent_id: null, sort_order: 3 }).conflicts[0].theirs.reason, 'stale-placement');
  command.after = { parentId: 'b', order: 2 };
  assert.deepEqual(mergeTreeCommand(data, 'a', command, { parent_id: 'b', sort_order: 2 }), { changes: {}, conflicts: [] });
});
test('本文の変更があっても削除・復元は削除印だけを変える', () => {
  const data = rows(); data[0].text = '別端末の最新';
  assert.deepEqual(mergeTreeCommand(data, 'a', { kind: 'tree-delete', before: false, after: true }, { deleted: 1 }), { changes: { deleted: 1 }, conflicts: [] });
  assert.equal(data[0].text, '別端末の最新');
});
test('削除済みの親の下へ古い端末が移そうとしても意図の保全に留める', () => {
  const data = rows(); data[1].deleted = true;
  const result = mergeTreeCommand(data, 'a', { kind: 'tree-move', before: { parentId: null, order: 0 }, after: { parentId: 'b', order: 2 } }, { parent_id: 'b', sort_order: 2 });
  assert.equal(result.conflicts[0].theirs.reason, 'deleted-parent');
  assert.deepEqual(result.changes, {});
});
test('単純なYjsの親ID方式では、各端末で合法な移動でも合流後の循環を再現する', () => {
  const a = fixtureDocument(), b = new Y.Doc();
  try {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const left = movePlacement(snapshot(a), 'row-1', 'row-2');
    const right = movePlacement(snapshot(b), 'row-2', 'row-1');
    a.getMap('rows').get('row-1').set('placement', left);
    b.getMap('rows').get('row-2').set('placement', right);
    const updateA = Y.encodeStateAsUpdate(a), updateB = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, updateB); Y.applyUpdate(b, updateA);
    assert.deepEqual(snapshot(a), snapshot(b));
    assert.deepEqual(analyzeTree(snapshot(a)).issues.cycles, [['row-1', 'row-2']]);
    assert.equal(analyzeTree(snapshot(a)).detached.length, 9);
  } finally { a.destroy(); b.destroy(); }
});
