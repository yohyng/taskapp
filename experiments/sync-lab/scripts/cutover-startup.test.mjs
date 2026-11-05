import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { checkCutoverRoute, prepareCutover, retryCutover, fetchCutoverRoute } from '../src/cutover-startup.js';
import { OUTLINE_FORMAT } from '../../../src/lib/outline-checkpoint.js';

const ownerId = randomUUID(), docId = randomUUID(), migrationId = randomUUID();
const approved = { format: 1, migrationId, ownerId, docId, legacyWritesBlocked: true };
const checkpoint = { format: OUTLINE_FORMAT, nodes: [], revision: 1, at: null, sync: { sequence: 0, pending: [], deleted: [], known: [] } };
function fixture() {
  const calls = [], signal = new AbortController(), storage = {
    id: `owner:${ownerId}:${docId}`, readCutover: async () => null, close: () => calls.push('終了'),
    captureCutover: async (record) => { calls.push('原本保存'); return record; }, readHandoff: async () => null,
    read: async () => ({ base: { snapshot: null, pending: null }, updates: [], outbox: [], cursor: -1 }),
  };
  const options = { ownerId, docId, storageId: storage.id, signal: signal.signal, activeOwner: () => ownerId,
    openStorage: async () => storage, route: async () => { calls.push('旧停止確認'); return approved; },
    capture: async () => { calls.push('旧読取'); return { checkpoint, originals: { localRaw: '原本' } }; },
    transport: { sync: async (_id, _body, _signal, context) => { calls.push('最新取得'); assert.deepEqual(context.batch, []); throw new Error('通信停止'); } },
  };
  return { options, storage, calls, signal };
}

test('切替起動：旧書き込みの停止・所有者・移行先が揃った経路だけを受け付ける', () => {
  assert.equal(checkCutoverRoute(approved, ownerId, docId), approved);
  for (const change of [{ legacyWritesBlocked: false }, { ownerId: randomUUID() }, { docId: randomUUID() }, { migrationId: '' }, { format: 2 }]) {
    assert.throws(() => checkCutoverRoute({ ...approved, ...change }, ownerId, docId));
  }
});

test('切替起動：旧停止確認・原本の確定保存より先に最新取得や送信を始めない', async () => {
  const f = fixture();
  await assert.rejects(prepareCutover(f.options), /通信停止/);
  assert.deepEqual(f.calls, ['旧停止確認', '旧読取', '原本保存', '最新取得', '終了']);
});

test('切替起動：停止未確認・原本保存失敗・所有者変更では空の新画面へ進まない', async () => {
  const badRoute = fixture(); badRoute.options.route = async () => ({ ...approved, legacyWritesBlocked: false });
  await assert.rejects(prepareCutover(badRoute.options)); assert.deepEqual(badRoute.calls, ['終了']);
  const failedSave = fixture(); failedSave.storage.captureCutover = async () => { throw new Error('容量不足'); };
  await assert.rejects(prepareCutover(failedSave.options), /容量不足/); assert.equal(failedSave.calls.includes('最新取得'), false);
  const switched = fixture();
  let owner = ownerId; switched.options.activeOwner = () => owner;
  switched.options.capture = async () => { owner = '別人'; return { checkpoint }; };
  await assert.rejects(prepareCutover(switched.options), /利用者/); assert.equal(switched.calls.includes('原本保存'), false);
});

test('切替起動：再開は保存済み原本を使い、旧端末の現在の表示から取り直さない', async () => {
  const f = fixture(); f.storage.readCutover = async () => ({ format: 1, ownerId, docId, migrationId, phase: 'captured', checkpoint });
  await assert.rejects(prepareCutover(f.options), /通信停止/);
  assert.deepEqual(f.calls, ['旧停止確認', '最新取得', '終了']);
});

test('切替起動：保存済みの確定記録があれば通信と旧保存を待たずに開ける', async () => {
  const f = fixture();
  f.storage.readCutover = async () => ({ format: 1, ownerId, docId, migrationId, phase: 'complete', checkpoint });
  f.storage.readHandoff = async (key) => ({ format: 1, key, ownerId, docId, archive: checkpoint, retained: [] });
  await prepareCutover(f.options); assert.deepEqual(f.calls, ['終了']);
  f.storage.readHandoff = async () => null;
  await assert.rejects(prepareCutover(f.options), /取得/);
});

test('切替起動：原本の所有者や世代が違う場合は、取り直しや通信で押し切らない', async () => {
  const f = fixture(); f.storage.readCutover = async () => ({ format: 1, ownerId: '別人', docId, migrationId, phase: 'captured', checkpoint });
  await assert.rejects(prepareCutover(f.options), /切り替え記録/); assert.deepEqual(f.calls, ['終了']);
  const newer = fixture(); newer.storage.readCutover = async () => ({ format: 1, ownerId, docId, migrationId: randomUUID(), phase: 'captured', checkpoint });
  await assert.rejects(prepareCutover(newer.options), /世代/); assert.equal(newer.calls.includes('旧読取'), false);
});

test('切替起動：通信の再試行待ちは中止でき、保存エラーを通信待ちとして隠さない', async () => {
  const controller = new AbortController(); let attempts = 0;
  await assert.rejects(retryCutover(async () => { attempts++; throw Object.assign(new Error('通信待ち'), { retryStartup: true }); }, controller.signal,
    () => controller.abort(new Error('終了'))), /終了/);
  assert.equal(attempts, 1);
  await assert.rejects(retryCutover(async () => { throw new Error('保存失敗'); }, new AbortController().signal), /保存失敗/);
});

test('切替起動：経路の401だけ一回更新し、別の拒否を接続成功へ変えない', async () => {
  let calls = 0, refreshed = 0;
  const client = { rpc: () => ({ abortSignal: async () => ++calls === 1 ? { error: {}, status: 401 } : { data: approved } }) };
  assert.equal(await fetchCutoverRoute(client, new AbortController().signal, async () => { refreshed++; return true; }), approved);
  assert.equal(refreshed, 1); assert.equal(calls, 2);
  await assert.rejects(fetchCutoverRoute({ rpc: () => ({ abortSignal: async () => ({ error: {}, status: 403 }) }) }, new AbortController().signal), (error) => error.status === 403 && !error.retryStartup);
});

test('切替起動：online復帰で待機時間を残さず再開し、完了後の通知から再実行しない', async () => {
  const events = new EventTarget(); let attempts = 0;
  const result = await retryCutover(async () => {
    attempts++; if (attempts === 1) throw Object.assign(new Error('通信待ち'), { retryStartup: true }); return '完了';
  }, new AbortController().signal, () => queueMicrotask(() => events.dispatchEvent(new Event('online'))), events);
  assert.equal(result, '完了'); assert.equal(attempts, 2);
  events.dispatchEvent(new Event('online')); await Promise.resolve(); assert.equal(attempts, 2);
});
