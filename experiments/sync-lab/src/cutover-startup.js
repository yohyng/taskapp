import { bigGet } from '../../../src/lib/localstore.js';
import { chooseOutlineSnapshot, readOutlineSnapshot, OUTLINE_FORMAT } from '../../../src/lib/outline-checkpoint.js';
import { openLoroStorage } from './loro-storage.js';
import { restoreLoroJournal } from './loro-journal.js';
import { commitOutlineHandoff, outlineHandoffKey } from './commit-outline-handoff.js';

const oldKey = 'taskspace-outline-v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function captureLegacyOutline() {
  const raw = localStorage.getItem(oldKey), local = raw === null ? null : JSON.parse(raw);
  const big = await bigGet(oldKey, { throwOnError: true });
  let legacyCopy = null;
  if (big?.format && local && !local.format) legacyCopy = await bigGet(oldKey + '-legacy-copy', { throwOnError: true })
    ?? JSON.parse(localStorage.getItem(oldKey + '-legacy-copy') || 'null');
  const selected = chooseOutlineSnapshot(local, big, legacyCopy);
  if (!selected && (local !== null && local !== undefined || big !== null && big !== undefined)) throw new Error('旧保存を空の文書として扱えません');
  const checkpoint = selected ?? { format: OUTLINE_FORMAT, revision: 0, at: null, nodes: [], complete: true,
    sync: { sequence: 0, pending: [], deleted: [], known: [] } };
  if (checkpoint.legacy || !readOutlineSnapshot(checkpoint)) throw new Error('旧保存の未送信記録を確認できません');
  return { checkpoint, originals: { localRaw: raw, big: big ?? null, legacyCopy } };
}

export function checkCutoverRoute(route, ownerId, docId) {
  if (!route || route.format !== 1 || !uuid.test(route.migrationId) || route.ownerId !== ownerId
    || route.docId !== docId || route.legacyWritesBlocked !== true) throw new Error('旧同期の停止と移行先を確認できません');
  return route;
}
function checkCapture(record, ownerId, docId) {
  if (!record || record.format !== 1 || record.ownerId !== ownerId || record.docId !== docId || !uuid.test(record.migrationId)
    || !['captured', 'complete'].includes(record.phase) || readOutlineSnapshot(record.checkpoint)?.legacy) throw new Error('保存済みの切り替え記録を確認できません');
  if (!readOutlineSnapshot(record.checkpoint)) throw new Error('切り替え前の原本がありません');
  return record;
}

export async function fetchCutoverRoute(client, signal, refreshSession) {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    const { data, error, status } = await client.rpc('taskspace_loro_cutover_route').abortSignal(AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10000)]));
    if (!error) return data;
    if (status === 401 && attempt === 0 && refreshSession && await refreshSession()) continue;
    throw Object.assign(new Error('切り替えの接続待ち'), { retryStartup: !status || status >= 500, status });
  }
}

export async function catchUpForCutover(storage, transport, docId, signal) {
  const saved = await storage.read(), doc = restoreLoroJournal(saved);
  let cursor = saved.cursor;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const context = { cursor, batch: [] };
      // 移行を保存する前は既存の送信待ちも送らず、最新の履歴だけを取得する。
      let result;
      try { result = await transport.sync(docId, { bootstrap: cursor === -1 }, signal ?? new AbortController().signal, context); }
      catch (error) { if (!signal?.aborted && (!error.status || error.status >= 500)) error.retryStartup = true; throw error; }
      signal?.throwIfAborted();
      const received = transport.decode(result, cursor === -1, context);
      if (received.more && received.cursor <= cursor) throw new Error('切り替え前の取得位置が進みません');
      for (const bytes of received.updates) doc.import(bytes);
      await storage.append({ updates: received.updates, outgoing: [], acknowledged: [], cursor: received.cursor });
      cursor = received.cursor;
      if (!received.more) return result.head;
    }
  } finally { doc.free(); }
}

// 新文書と旧保存の両方のWeb Lockを持つ起動区間だけで呼ぶ。完了後の通常起動は
// サーバーの確認や旧保存の読み直しを待たず、保存済みの新文書をそのまま開く。
export async function prepareCutover({ ownerId, docId, storageId, signal, activeOwner, transport, route,
  capture = captureLegacyOutline, openStorage = openLoroStorage }) {
  const active = () => !signal?.aborted && activeOwner() === ownerId;
  const checkActive = () => { signal?.throwIfAborted(); if (!active()) throw new Error('切り替え中に利用者が変わりました'); };
  checkActive();
  if (storageId !== `owner:${ownerId}:${docId}`) throw new Error('切り替える保存先が違います');
  const storage = await openStorage(storageId);
  try {
    let record = await storage.readCutover(); checkActive();
    if (record) {
      checkCapture(record, ownerId, docId);
      if (record.phase === 'complete') {
        await commitOutlineHandoff({ storage, checkpoint: record.checkpoint, ownerId, legacyOwnerId: ownerId, docId, activeOwner });
        return;
      }
    }
    const approved = checkCutoverRoute(await route(signal), ownerId, docId); checkActive();
    if (record && record.migrationId !== approved.migrationId) throw new Error('切り替え先の世代が違います');
    if (!record) {
      const source = await capture(); checkActive();
      if (!source || !readOutlineSnapshot(source.checkpoint) || readOutlineSnapshot(source.checkpoint).legacy) throw new Error('引き継ぐ旧保存を読めません');
      record = await storage.captureCutover({ format: 1, migrationId: approved.migrationId, ownerId, docId, phase: 'captured', checkpoint: source.checkpoint, originals: source.originals });
      checkCapture(record, ownerId, docId); checkActive();
      if (record.migrationId !== approved.migrationId) throw new Error('捕捉した原本の世代が違います');
    }
    const key = await outlineHandoffKey(record.checkpoint), previous = await storage.readHandoff(key); checkActive();
    const head = previous ? undefined : await catchUpForCutover(storage, transport, docId, signal); checkActive();
    await commitOutlineHandoff({ storage, checkpoint: record.checkpoint, ownerId, legacyOwnerId: ownerId, docId, activeOwner, remoteHead: head });
    checkActive(); await storage.finishCutover(record, key);
  } finally { storage.close(); }
}

export async function retryCutover(action, signal, onWaiting = () => {}, events = globalThis) {
  let failures = 0;
  for (;;) {
    signal?.throwIfAborted();
    try { return await action(); }
    catch (error) {
      if (!error.retryStartup || signal?.aborted) throw error;
      onWaiting();
      await new Promise((resolve, reject) => {
        const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); events.removeEventListener?.('online', done); };
        const done = () => { clean(); resolve(); };
        const abort = () => { clean(); reject(signal.reason); };
        const timer = setTimeout(done, Math.min(10000, 500 * 2 ** Math.min(failures++, 5)));
        signal?.addEventListener('abort', abort, { once: true });
        events.addEventListener?.('online', done, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }
}
