import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenTree, outlineRowSignature } from '../../../src/lib/outline.js';
import { outlineCheckpoint } from '../../../src/lib/outline-checkpoint.js';
import { planLegacyOutlineHandoff } from '../src/legacy-outline-handoff.js';
import { prepareHandoff } from './prepare-outline-handoff.mjs';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedOutlineDocument, outlineNodes } from '../src/outline-model.js';
import { loroViewRows } from '../src/loro-model.js';
import { commitOutlineHandoff } from '../src/commit-outline-handoff.js';
import { LoroDoc } from 'loro-crdt';

const original = [{ id: 'a', text: '元の本文', children: [] }, { id: 'b', text: '別の行', children: [] }];
function saved(nodes, operations = []) {
  return outlineCheckpoint(nodes, { sequence: operations.length ? 1 : 0,
    pending: new Map(operations.map((operation) => [operation.id, { version: 1, kind: 'put', ...operation }])) },
  new Set(operations.filter((operation) => operation.kind === 'delete').map((operation) => operation.id)), new Set(['a', 'b']), 1, '2026-11-05');
}
const operation = (nodes = original) => ({ id: 'a', positionChanged: false, baseSignature: outlineRowSignature(flattenTree(nodes)[0]) });

test('移行：古い端末を開くだけなら、本文・色・順序が違っても書き戻し候補を作らない', () => {
  const latest = [{ ...original[1], text: '別端末の最新' }, { ...original[0], text: '新しい本文', textColor: '#00ff00' }];
  const plan = planLegacyOutlineHandoff(saved(original), latest);
  assert.deepEqual([plan.changes, plan.retained, plan.settled], [[], [], []]);
});

test('移行：実際に編集した本文だけを候補にし、最新の色・位置・日時は巻き戻さない', () => {
  const local = structuredClone(original); local[0].text += '・追記'; local[0].updatedAt = '2026-11-05T01:00:00Z';
  const latest = [original[1], { ...original[0], textColor: '#00ff00', updatedAt: '2026-11-05T02:00:00Z' }];
  const plan = planLegacyOutlineHandoff(saved(local, [operation()]), latest);
  assert.deepEqual(plan.changes, [{ id: 'a', set: { text: '元の本文・追記' }, expected: { text: '元の本文' } }]);
  assert.deepEqual(plan.retained, []);
});

test('移行：相容れない本文は原本に残し、安全な別項目は分けて候補にする', () => {
  const local = structuredClone(original); local[0].text = '手元の本文'; local[0].favorite = true;
  const latest = structuredClone(original); latest[0].text = '別端末の本文';
  const plan = planLegacyOutlineHandoff(saved(local, [operation()]), latest);
  assert.deepEqual(plan.changes, [{ id: 'a', set: { favorite: true }, expected: { favorite: false } }]);
  assert.deepEqual(plan.retained, [{ id: 'a', reason: 'field-conflict', fields: ['text'] }]);
  assert.equal(plan.archive.nodes[0].text, '手元の本文');
});

test('移行：基準の欠落・破損を最新に対する編集扱いにせず原本に残す', () => {
  const local = structuredClone(original); local[0].text = '手元';
  for (const baseSignature of [undefined, '{', '{}', JSON.stringify({ ...flattenTree(original)[0], id: 'wrong' })]) {
    const plan = planLegacyOutlineHandoff(saved(local, [{ id: 'a', baseSignature }]), original);
    assert.deepEqual(plan.changes, []);
    assert.deepEqual(plan.retained, [{ id: 'a', reason: 'missing-base' }]);
  }
});

test('移行：送信結果が既に一致する再開は差分を増やさず、基準がない場合も一致で確認する', () => {
  const local = structuredClone(original); local[0].text += '・追記';
  for (const op of [operation(), { id: 'a' }]) {
    const plan = planLegacyOutlineHandoff(saved(local, [op]), local);
    assert.deepEqual([plan.changes, plan.retained, plan.settled], [[], [], ['a']]);
  }
});

test('移行：作成の根拠がない行や削除の基準がない行は保全し、消された行を復活させない', () => {
  const added = [...original, { id: 'new', text: '新規', children: [] }];
  assert.deepEqual(planLegacyOutlineHandoff(saved(added, [{ id: 'new' }]), original).retained, [{ id: 'new', reason: 'missing-target' }]);
  const removed = saved([original[1]], [{ id: 'a', kind: 'delete' }]);
  assert.deepEqual(planLegacyOutlineHandoff(removed, original).retained, [{ id: 'a', reason: 'delete-conflict' }]);
  assert.deepEqual(planLegacyOutlineHandoff(removed, [original[1]]).settled, ['a']);
  const moved = [original[1], original[0]];
  const plan = planLegacyOutlineHandoff(saved(moved, [{ ...operation(), positionChanged: true }]), original);
  assert.deepEqual(plan.retained, []); assert.equal(plan.structures[0].kind, 'move');
  const edited = structuredClone(original); edited[0].text += '・追記';
  assert.deepEqual(planLegacyOutlineHandoff(saved(edited, [operation()]), [original[1]]).retained, [{ id: 'a', reason: 'missing-target' }]);
});

test('移行：新規親子は親から作り、現在の兄弟IDを挿入位置の目印にする', () => {
  const local = [original[0], { id: 'new', text: '親', children: [{ id: 'child', text: '子', children: [] }] }, original[1]];
  const plan = planLegacyOutlineHandoff(saved(local, [{ id: 'child', expectedRevision: 0 }, { id: 'new', expectedRevision: 0 }]), original);
  assert.deepEqual(plan.structures.map((command) => [command.id, command.placement]), [
    ['new', { parentId: null, beforeId: 'b', afterId: 'a' }], ['child', { parentId: 'new', beforeId: null, afterId: null }],
  ]);
  assert.deepEqual(plan.retained, []);
  assert.deepEqual(planLegacyOutlineHandoff(saved(local, [{ id: 'new', expectedRevision: 0 }, { id: 'child', expectedRevision: 0 }]), original,
    { reservedIds: new Set(['new']) }).structures, []);
});

test('移行：削除する枝の全行が編集前と一致するときだけ枝の削除を候補にする', () => {
  const old = [{ id: 'a', text: '枝', children: [{ id: 'child', text: '子', children: [] }] }, original[1]];
  const ops = flattenTree(old).slice(0, 2).map((row) => ({ id: row.id, kind: 'delete', baseSignature: outlineRowSignature(row) }));
  const checkpoint = saved([original[1]], ops);
  const plan = planLegacyOutlineHandoff(checkpoint, old);
  assert.deepEqual(plan.structures.map((command) => [command.kind, command.id, command.expected.map((row) => row.id)]), [['delete', 'a', ['a', 'child']]]);
  const edited = structuredClone(old); edited[0].children[0].text += '・別端末';
  const added = structuredClone(old); added[0].children.push({ id: 'remote', text: '別端末の新規行', children: [] });
  for (const latest of [edited, added]) {
    const blocked = planLegacyOutlineHandoff(checkpoint, latest);
    assert.deepEqual(blocked.structures, []);
    assert.deepEqual(blocked.retained.map((entry) => entry.reason), ['delete-conflict', 'delete-conflict']);
  }
});

test('移行：別端末で位置が変わった枝や循環する移動は保全して最新の木を維持する', () => {
  const moved = [original[1], original[0]], checkpoint = saved(moved, [{ ...operation(), positionChanged: true }]);
  const shifted = [{ id: 'remote', text: '追加', children: [] }, ...original];
  assert.equal(planLegacyOutlineHandoff(checkpoint, shifted).retained[0].reason, 'stale-placement');
  const old = [{ ...original[0], children: [] }, { id: 'c', text: '別枝', children: [] }];
  const local = [{ ...old[1], children: [old[0]] }], latest = [{ ...old[0], children: [old[1]] }];
  const cycle = planLegacyOutlineHandoff(saved(local, [{ ...operation(old), positionChanged: true }]), latest);
  assert.equal(cycle.retained[0].reason, 'invalid-parent'); assert.deepEqual(cycle.structures, []);
});

test('移行の実適用：四行の全並べ替えと、新規親への既存枝の移動をLoroの差分として復元する', async () => {
  const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id, text: id, children: [] }));
  const permutations = (list) => list.length ? list.flatMap((item) => permutations(list.filter((other) => other !== item)).map((rest) => [item, ...rest])) : [[]];
  const cases = permutations(rows).flatMap((nodes) => [{ nodes }, { nodes, reverse: true }]);
  cases.push({ nodes: [{ id: 'new', text: '新規の親', children: [rows[0], { id: 'new-child', text: '新規の子', children: [] }] }, ...rows.slice(1)] });
  for (const { nodes, reverse } of cases) {
    const base = new Map(flattenTree(rows).map((row) => [row.id, row]));
    const operations = flattenTree(nodes).filter((row) => !base.has(row.id) || row.parentId !== base.get(row.id).parentId || row.sortOrder !== base.get(row.id).sortOrder)
      .map((row) => ({ id: row.id, positionChanged: true, ...(base.has(row.id) ? { baseSignature: outlineRowSignature(base.get(row.id)) } : { expectedRevision: 0 }) }));
    const doc = seedOutlineDocument(rows), restored = new LoroDoc();
    try {
      const snapshot = doc.export({ mode: 'snapshot' }); restored.import(snapshot);
      let entries;
      const storage = { id: 'owner:alice:doc', readHandoff: async () => null,
        read: async () => ({ base: { snapshot: null, generation: 0, cutoff: 0 }, updates: [{ sequence: 1, bytes: snapshot }], outbox: [], cursor: 0 }),
        async commitHandoff({ updates }) { entries = updates; return true; } };
      const result = await commitOutlineHandoff({ storage, checkpoint: saved(nodes, reverse ? operations.reverse() : operations), ownerId: 'alice', legacyOwnerId: 'alice', docId: 'doc', activeOwner: () => 'alice', remoteHead: 0 });
      entries.forEach((bytes) => restored.import(bytes));
      assert.deepEqual(result.receipt.retained, []);
      const shape = (tree) => tree.map((node) => ({ id: node.id, children: shape(node.children ?? []) }));
      assert.deepEqual(shape(outlineNodes(loroViewRows(restored))), shape(nodes));
    } finally { doc.free(); restored.free(); }
  }
});

test('移行：本文が変わらず日時だけ違っても、送信や確認の候補を作らない', () => {
  const local = structuredClone(original); local[0].updatedAt = '2026-11-05T00:00:00Z';
  const plan = planLegacyOutlineHandoff(saved(local, [operation()]), original);
  assert.deepEqual([plan.changes, plan.retained, plan.settled], [[], [], ['a']]);
});

test('移行：入力を変更せず、控えも入力と参照を共有しない', () => {
  const local = structuredClone(original); local[0].text += '・追記';
  const checkpoint = saved(local, [operation()]), copy = structuredClone(checkpoint), latest = structuredClone(original);
  const plan = planLegacyOutlineHandoff(checkpoint, latest);
  assert.deepEqual(checkpoint, copy); assert.deepEqual(latest, original);
  plan.archive.nodes[0].text = '控えのコピー'; plan.archive.sync.pending.length = 0;
  assert.deepEqual(checkpoint, copy);
});

test('移行：未対応の属性がある未送信行を、処理済みとして捨てない', () => {
  const local = structuredClone(original); local[0].futureAttribute = '保全する値';
  const plan = planLegacyOutlineHandoff(saved(local, [operation()]), original);
  assert.deepEqual([plan.changes, plan.settled], [[], []]);
  assert.deepEqual(plan.retained, [{ id: 'a', reason: 'unsupported-fields', fields: ['futureAttribute'] }]);
  assert.equal(plan.archive.nodes[0].futureAttribute, '保全する値');
});

test('移行：壊れたキュー・重複ID・旧配列から未送信なしとは推測しない', () => {
  assert.throws(() => planLegacyOutlineHandoff({ nodes: original }, original), /旧保存/);
  const broken = saved(original); broken.sync.pending = [{ id: 'missing', version: 1, kind: 'put' }];
  assert.throws(() => planLegacyOutlineHandoff(broken, original), /未送信/);
  assert.throws(() => planLegacyOutlineHandoff(saved([original[0], original[0]]), original), /行ID/);
});

test('移行候補：実際の書き出し形式から原本二つと計画を保存し、既存出力を上書きしない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taskspace-handoff-'));
  const local = structuredClone(original); local[0].text += '・追記';
  const checkpoint = saved(local, [operation()]);
  const source = JSON.stringify({ app: 'taskspace-outline', version: 1, items: local,
    syncDiagnostic: { revision: checkpoint.revision, at: checkpoint.at, sync: checkpoint.sync } });
  const latest = JSON.stringify({ items: original });
  const input = join(directory, 'input.json'), target = join(directory, 'latest.json'), output = join(directory, 'candidate');
  await writeFile(input, source); await writeFile(target, latest);
  const manifest = await prepareHandoff(input, target, output);
  assert.equal(manifest.pending, 1); assert.equal(manifest.changes, 1); assert.equal(manifest.applied, false);
  assert.equal(await readFile(input, 'utf8'), source); assert.equal(await readFile(target, 'utf8'), latest);
  assert.equal(await readFile(join(output, 'source.json'), 'utf8'), source);
  assert.equal(await readFile(join(output, 'latest.json'), 'utf8'), latest);
  const plan = JSON.parse(await readFile(join(output, 'plan.json'), 'utf8'));
  assert.deepEqual(plan.archive, checkpoint);
  assert.deepEqual(plan.changes[0].set, { text: '元の本文・追記' });
  await assert.rejects(prepareHandoff(input, target, output), /EEXIST/);
});

test('移行候補：未送信の記録がない書き出しでは候補を作らず、元ファイルを残す', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taskspace-handoff-missing-'));
  const input = join(directory, 'input.json'), output = join(directory, 'candidate');
  const source = JSON.stringify({ app: 'taskspace-outline', version: 1, items: original });
  await writeFile(input, source);
  await assert.rejects(prepareHandoff(input, input, output), /未送信/);
  await assert.rejects(access(output), /ENOENT/);
  assert.equal(await readFile(input, 'utf8'), source);
});
