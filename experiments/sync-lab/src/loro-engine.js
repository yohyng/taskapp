import { UndoManager } from 'loro-crdt';
import { checkpointLoroJournal, restoreLoroJournal } from './loro-journal.js';
import { createLoroProjection } from './loro-projection.js';
import { openLoroStorage } from './loro-storage.js';
import { analyzeTree, movePlacement } from './tree-model.js';
import { scopedLoroSource } from './loro-binding.js';
import { decodeLoroTransfer, loroSyncRequest } from './loro-transfer.js';
import { loroTransport } from './loro-transport.js';
import { applyOutlineIntent, outlineNodes } from './outline-model.js';

export async function createEngine({ docId, offline, onChange, transport = loroTransport(), storageId = docId, signal, background = false, onError = (error) => { document.querySelector('[data-error]').textContent = `端末保存を確認できません：${error.message}`; } }) {
  const storage = await openLoroStorage(storageId);
  let saved, doc;
  try { saved = await storage.read(); doc = restoreLoroJournal(saved); }
  catch (error) { storage.close(); throw error; }
  let outbox = saved.outbox, cursor = saved.cursor, saving = Promise.resolve(), saves = 0, fatal, enabled = false;
  let urgent = false;
  let journalCount = saved.updates.length, journalBytes = saved.updates.reduce((total, entry) => total + entry.bytes.length, 0);
  let compacting, compactTimer, closing = false, compactionFailures = 0;
  let connected = false, timer, flight, controller, selectionForHistory = null, lastNotification, resumeAfterHide = false, failures = 0;
  const transfers = { snapshots: 0, updates: 0, receivedBytes: 0 };
  let projection, undo, stopLocal, stop;
  const selections = new Map(), node = (id) => projection.node(id), snapshot = () => projection.snapshot();
  const notify = () => {
    if (!projection) return;
    const state = { rows: snapshot(), connected, queued: !!fatal || saves > 0 || outbox.length > 0 };
    // 通信・保存の状態だけが変わる通知は同じ行配列を使い、全文JSONを毎回作らない。
    if (lastNotification?.rows === state.rows && lastNotification.connected === state.connected && lastNotification.queued === state.queued) return;
    lastNotification = state; onChange?.(state);
  };
  function scheduleCompaction() {
    if (closing || compacting || compactTimer || (journalCount < 128 && journalBytes < 1024 * 1024)) return;
    compactTimer = setTimeout(() => { compactTimer = null; compactLocal().catch(() => {}); }, 1000);
  }
  function compactLocal() {
    if (compacting) return compacting;
    clearTimeout(compactTimer); compactTimer = null;
    let completed = false;
    compacting = storage.compact(checkpointLoroJournal).then((result) => {
      journalCount = Math.max(0, journalCount - result.count); journalBytes = Math.max(0, journalBytes - result.bytes);
      completed = true;
      return result;
    }).catch((error) => {
      // まとめ直しは追記の確定とは別。失敗しても元のログは残るため、入力を止めない。
      compactionFailures++; throw error;
    }).finally(() => { compacting = null; if (completed) scheduleCompaction(); });
    return compacting;
  }
  function persist(value) {
    saves++;
    saving = saving.then(() => storage.append(value)).then(() => {
      journalCount += value.updates.length; journalBytes += value.updates.reduce((total, bytes) => total + bytes.length, 0);
      scheduleCompaction();
    }).catch((error) => {
      fatal = error; enabled = false;
      onError(error);
      throw error;
    }).finally(() => { saves--; notify(); });
    saving.catch(() => {});
    return saving;
  }
  function observe() {
    projection = createLoroProjection(doc);
    undo = new UndoManager(doc, {
      mergeInterval: 0,
      onPush: () => ({ value: selectionForHistory ? { id: selectionForHistory.id } : null, cursors: selectionForHistory?.cursors || [] }),
      onPop: (_isUndo, entry) => {
        if (entry.value?.id) queueMicrotask(() => selections.get(entry.value.id)?.restore(entry.cursors));
      },
    });
    stopLocal = doc.subscribeLocalUpdates((bytes) => {
      const entry = { id: crypto.randomUUID(), bytes: bytes.slice() };
      outbox.push(entry); persist({ updates: [entry.bytes], outgoing: [entry], acknowledged: [] });
      wake();
    });
    stop = doc.subscribe((event) => { projection.apply(event); notify(); });
  }
  function unobserve() { stop?.(); stopLocal?.(); undo?.free(); }
  function local(action) { if (fatal) throw fatal; selectionForHistory = null; action(); doc.commit({ origin: '操作' }); }
  async function barrier() {
    // 待機中に次の保存が追加された場合も確定を待つ。最初のPromiseだけでは後の編集を先に送ってしまう。
    let observed;
    do { observed = saving; await observed; } while (observed !== saving);
    if (fatal) throw fatal;
  }
  async function sync() {
    try {
      await barrier();
      if (!enabled || fatal) return;
      const batch = transport.batch ? transport.batch(outbox) : outbox.slice();
      const request = loroSyncRequest(doc, batch);
      controller = new AbortController();
      const context = { cursor, batch };
      const result = await transport.sync(docId, request, controller.signal, context);
      if (!enabled) return;
      const received = (transport.decode || decodeLoroTransfer)(result, request.bootstrap, context);
      const before = JSON.stringify([...doc.oplogVersion().encode()]), waiting = JSON.stringify([...(doc.exportPendingUpdates() || [])]);
      // 単独snapshotのimportを使い、空の文書へ全履歴を一操作ずつ再生する経路を避ける。
      // 初回失敗後の再取得も、空の原本に限り購読を外す。既存の編集やUndoがあれば保持する。
      const restart = projection && received.mode === 'snapshot' && loroSyncRequest(doc, outbox).bootstrap;
      if (restart) unobserve();
      try { for (const bytes of received.updates) doc.import(bytes); } finally { if (restart) observe(); }
      const changed = JSON.stringify([...doc.oplogVersion().encode()]) !== before || JSON.stringify([...(doc.exportPendingUpdates() || [])]) !== waiting;
      if (batch.length || changed || received.cursor !== undefined && received.cursor !== cursor) await persist({ updates: changed ? received.updates : [], outgoing: [], acknowledged: batch.map((entry) => entry.id), cursor: received.cursor });
      outbox.splice(0, batch.length);
      if (received.cursor !== undefined) cursor = received.cursor;
      if (received.more || outbox.length) urgent = true;
      transfers[received.mode === 'snapshot' ? 'snapshots' : 'updates']++;
      transfers.receivedBytes += received.updates.reduce((total, bytes) => total + bytes.length, 0);
      failures = 0; connected = true; notify();
    } catch (error) {
      failures++; connected = false;
      // 認証切れや権限拒否を100msごとに繰り返さない。ログイン状態が戻ったらconnectで再開する。
      if ([401, 403].includes(error.status)) enabled = false;
      notify();
    }
  }
  function tick() {
    if (!enabled || flight || fatal) return flight;
    urgent = false;
    flight = sync().finally(() => { flight = null; if (enabled && !fatal) timer = setTimeout(tick, failures ? Math.min(15000, 250 * 2 ** Math.min(failures, 6)) : urgent ? 0 : transport.interval ?? 100); });
    return flight;
  }
  function wake() { urgent = true; if (enabled && !flight && !fatal) { clearTimeout(timer); timer = setTimeout(tick, 0); } }
  const stopWatch = transport.watch?.(docId, wake);
  async function disconnect() { enabled = false; resumeAfterHide = false; clearTimeout(timer); controller?.abort(); await flight; connected = false; notify(); }
  async function connect() { if (fatal) throw fatal; if (closing || signal?.aborted) return; enabled = true; clearTimeout(timer); await tick(); }
  const hide = () => { if (enabled) resumeAfterHide = true; enabled = false; clearTimeout(timer); controller?.abort(); };
  const show = (event) => { if (event.persisted && resumeAfterHide) connect().catch(() => {}); };
  window.addEventListener('beforeunload', hide); window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
  signal?.addEventListener('abort', hide);
  function history(redo) {
    const current = [...selections.values()].find((item) => item.focused());
    selectionForHistory = current?.capture() || null;
    return redo ? undo.redo() : undo.undo();
  }
  // 空の文書を先に購読すると、snapshotでも全ノードの差分通知を作ってしまう。
  // 初回は保存まで終えてから表示とUndoを接続し、履歴のある端末は従来どおり先に表示する。
  const cold = !offline && loroSyncRequest(doc, outbox).bootstrap;
  if (!cold) { observe(); notify(); }
  scheduleCompaction();
  if (!offline) {
    // 保存済みの文書は通信待ちで隠さない。空の初回だけは購読前のsnapshot取得を保つ。
    if (background && !cold) connect().catch(() => {});
    else await connect();
  }
  if (cold) observe(); notify();
  return {
    kind: 'loro', snapshot, queued: () => !!fatal || saves > 0 || outbox.length > 0,
    connectionState: () => ({ connected, ready: !transport.decode || cursor >= 0 }),
    inputState: (id) => ({ text: node(id).data.get('text').toString(), draft: false }),
    treeState: () => analyzeTree(snapshot()),
    nativeIds: () => projection.nativeIds(),
    projectionStats: () => projection.stats(),
    persistenceStats: () => ({ ...storage.stats(), journalCount, journalBytes, compactionFailures }),
    transferStats: () => ({ ...transfers }),
    compactLocal,
    loroBinding(id) {
      const text = node(id).data.get('text'), origin = `入力:${id}:${crypto.randomUUID()}`;
      const source = scopedLoroSource(doc, text, origin, () => { if (fatal) throw fatal; });
      return {
        text,
        source,
        rawSource: doc,
        receiving: source.receiving,
        remember(anchor, head) { selectionForHistory = { id, cursors: [text.getCursor(anchor), text.getCursor(head)] }; },
        selection(register) { selections.set(id, register); return () => selections.delete(id); },
        cursorPosition: (cursor) => cursor && doc.getCursorPos(cursor)?.offset,
        capture(anchor, head) { return { id, cursors: [text.getCursor(anchor), text.getCursor(head)] }; },
      };
    },
    replaceText(id, value) { local(() => node(id).data.get('text').update(value)); },
    insertText(id, position, value) { local(() => node(id).data.get('text').insert(position, value)); },
    setAttribute(id, field, value) {
      if (!['favorite', 'completed'].includes(field) || typeof value !== 'boolean') throw new Error('属性が不正です');
      if (node(id).data.get(field) !== value) local(() => node(id).data.set(field, value));
    },
    moveBranch(id, parentId, order) {
      const rows = snapshot(); movePlacement(rows, id, parentId, order);
      const siblings = rows.filter((row) => row.parentId === parentId && row.id !== id);
      const target = order === undefined ? siblings.length : Math.max(0, Math.min(order, siblings.length));
      const current = rows.find((row) => row.id === id);
      if (current.parentId === parentId && current.order === target) return;
      local(() => node(id).move(parentId === null ? undefined : node(parentId), target));
    },
    setBranchDeleted(id, value) {
      if (typeof value !== 'boolean') throw new Error('削除印が不正です');
      if (node(id).data.get('deleted') !== value) local(() => node(id).data.set('deleted', value));
    },
    editBatch() { local(() => {
      node('row-0').data.get('text').insert(0, '同じ受信：');
      node('row-3').data.get('text').insert(0, '別の行：');
      node('row-0').data.set('favorite', true);
      node('row-1').move(node('row-2'));
    }); },
    undo: () => history(false), redo: () => history(true), connect, disconnect,
    localBarrier: barrier,
    outline: () => outlineNodes(snapshot()),
    changeOutline(makeNext) { local(() => { const before = outlineNodes(snapshot()); applyOutlineIntent(doc, before, typeof makeNext === 'function' ? makeNext(before) : makeNext); }); },
    canUndo: () => undo.canUndo(), canRedo: () => undo.canRedo(),
    serverState: () => transport.serverState(docId),
    async dispose() { closing = true; stopWatch?.(); clearTimeout(compactTimer); signal?.removeEventListener('abort', hide); window.removeEventListener('beforeunload', hide); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); try { await disconnect(); await saving; await compacting?.catch(() => {}); } finally { unobserve(); doc.free(); storage.close(); } },
  };
}
