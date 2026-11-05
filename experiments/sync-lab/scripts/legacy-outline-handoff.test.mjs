import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenTree, outlineRowSignature } from '../../../src/lib/outline.js';
import { outlineCheckpoint } from '../../../src/lib/outline-checkpoint.js';
import { planLegacyOutlineHandoff } from '../src/legacy-outline-handoff.js';
import { prepareHandoff } from './prepare-outline-handoff.mjs';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('移行：新規行・削除・移動は構造用の次工程まで保全し、消された行を復活させない', () => {
  const added = [...original, { id: 'new', text: '新規', children: [] }];
  assert.deepEqual(planLegacyOutlineHandoff(saved(added, [{ id: 'new' }]), original).retained, [{ id: 'new', reason: 'missing-target' }]);
  const removed = saved([original[1]], [{ id: 'a', kind: 'delete' }]);
  assert.deepEqual(planLegacyOutlineHandoff(removed, original).retained, [{ id: 'a', reason: 'structure' }]);
  assert.deepEqual(planLegacyOutlineHandoff(removed, [original[1]]).settled, ['a']);
  const moved = [original[1], original[0]];
  assert.deepEqual(planLegacyOutlineHandoff(saved(moved, [{ ...operation(), positionChanged: true }]), original).retained, [{ id: 'a', reason: 'structure' }]);
  const edited = structuredClone(original); edited[0].text += '・追記';
  assert.deepEqual(planLegacyOutlineHandoff(saved(edited, [operation()]), [original[1]]).retained, [{ id: 'a', reason: 'missing-target' }]);
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
