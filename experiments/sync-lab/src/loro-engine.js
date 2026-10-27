import { LoroDoc, UndoManager } from 'loro-crdt';
import { loroCheckpoint, restoreLoroCheckpoint } from './loro-model.js';
import { createLoroProjection } from './loro-projection.js';
import { openLoroStorage } from './loro-storage.js';
import { analyzeTree, movePlacement } from './tree-model.js';
import { scopedLoroSource } from './loro-binding.js';

export async function createEngine({ docId, offline, onChange }) {
  const storage = await openLoroStorage(docId), saved = await storage.read();
  const doc = saved ? restoreLoroCheckpoint(saved) : new LoroDoc();
  let outbox = saved?.outbox || [], saving = Promise.resolve(), saves = 0, fatal, enabled = false;
  let connected = false, timer, flight, controller, selectionForHistory = null, lastNotification, resumeAfterHide = false;
  const projection = createLoroProjection(doc), selections = new Map();
  const node = projection.node, snapshot = projection.snapshot;
  const notify = () => {
    const state = { rows: snapshot(), connected, queued: !!fatal || saves > 0 || outbox.length > 0 };
    // 通信・保存の状態だけが変わる通知は同じ行配列を使い、全文JSONを毎回作らない。
    if (lastNotification?.rows === state.rows && lastNotification.connected === state.connected && lastNotification.queued === state.queued) return;
    lastNotification = state; onChange?.(state);
  };
  function persist() {
    const value = { ...loroCheckpoint(doc), outbox: outbox.slice() };
    saves++;
    saving = saving.then(() => storage.write(value)).catch((error) => {
      fatal = error; enabled = false;
      document.querySelector('[data-error]').textContent = `端末保存を確認できません：${error.message}`;
      throw error;
    }).finally(() => { saves--; notify(); });
    saving.catch(() => {});
    return saving;
  }
  const undo = new UndoManager(doc, {
    mergeInterval: 0,
    onPush: () => ({ value: selectionForHistory ? { id: selectionForHistory.id } : null, cursors: selectionForHistory?.cursors || [] }),
    onPop: (_isUndo, entry) => {
      if (entry.value?.id) queueMicrotask(() => selections.get(entry.value.id)?.restore(entry.cursors));
    },
  });
  const stopLocal = doc.subscribeLocalUpdates((bytes) => {
    outbox.push(bytes); persist();
  });
  const stop = doc.subscribe((event) => { projection.apply(event); notify(); });
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
      const batch = outbox.slice();
      controller = new AbortController();
      const response = await fetch(`/lab/loro/sync?doc=${encodeURIComponent(docId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ version: [...doc.oplogVersion().encode()], updates: batch.map((bytes) => [...bytes]) }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      if (!enabled) return;
      const before = JSON.stringify([...doc.oplogVersion().encode()]), waiting = JSON.stringify([...(doc.exportPendingUpdates() || [])]);
      doc.import(Uint8Array.from(result.update));
      outbox.splice(0, batch.length);
      if (batch.length || JSON.stringify([...doc.oplogVersion().encode()]) !== before || JSON.stringify([...(doc.exportPendingUpdates() || [])]) !== waiting) await persist();
      connected = true; notify();
    } catch (error) { connected = false; notify(); }
  }
  function tick() {
    if (!enabled || flight || fatal) return flight;
    flight = sync().finally(() => { flight = null; if (enabled && !fatal) timer = setTimeout(tick, 100); });
    return flight;
  }
  async function disconnect() { enabled = false; resumeAfterHide = false; clearTimeout(timer); controller?.abort(); await flight; connected = false; notify(); }
  async function connect() { if (fatal) throw fatal; enabled = true; clearTimeout(timer); await tick(); }
  const hide = () => { if (enabled) resumeAfterHide = true; enabled = false; clearTimeout(timer); controller?.abort(); };
  const show = (event) => { if (event.persisted && resumeAfterHide) connect().catch(() => {}); };
  window.addEventListener('beforeunload', hide); window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
  function history(redo) {
    const current = [...selections.values()].find((item) => item.focused());
    selectionForHistory = current?.capture() || null;
    return redo ? undo.redo() : undo.undo();
  }
  notify(); if (!offline) await connect();
  return {
    kind: 'loro', snapshot, queued: () => !!fatal || saves > 0 || outbox.length > 0,
    inputState: (id) => ({ text: node(id).data.get('text').toString(), draft: false }),
    treeState: () => analyzeTree(snapshot()),
    nativeIds: projection.nativeIds,
    projectionStats: projection.stats,
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
    async serverState() {
      const response = await fetch(`/lab/loro/server-state?doc=${encodeURIComponent(docId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('検証用の保存内容を確認できません');
      return response.json();
    },
    async dispose() { window.removeEventListener('beforeunload', hide); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); await disconnect(); await saving; stop(); stopLocal(); undo.free(); doc.free(); storage.close(); },
  };
}
