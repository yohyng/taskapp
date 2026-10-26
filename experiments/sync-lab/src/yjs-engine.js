import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { replaceText, snapshot } from './model.js';
import { analyzeTree, movePlacement } from './tree-model.js';

export async function createEngine({ docId, offline, onChange }) {
  const doc = new Y.Doc();
  const origin = { device: 'このブラウザーの編集' };
  const persistence = new IndexeddbPersistence(`taskspace-lab-yjs-${docId}`, doc);
  await persistence.whenSynced;
  const undo = new Y.UndoManager(doc.getMap('rows'), { trackedOrigins: new Set([origin]), captureTimeout: 0 });
  // v4では接続をsocket側で管理する。旧connectオプションは圏外起動を止めない。
  const socket = new HocuspocusProviderWebsocket({ url: 'ws://127.0.0.1:4181', autoConnect: false });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: docId, document: doc, awareness: null });
  let connected = false;
  const changed = () => onChange?.({ rows: snapshot(doc), connected, queued: provider.hasUnsyncedChanges });
  provider.on('status', ({ status }) => { connected = status === 'connected'; changed(); });
  provider.on('synced', changed);
  provider.on('unsyncedChanges', changed);
  doc.on('update', changed);
  provider.attach();
  if (!offline) socket.connect();
  async function localBarrier() {
    // 編集で作られた取引の後ろに置き、試験で「保存要求を出した」と「確定した」を分ける。
    await persistence.whenSynced;
    await new Promise((resolve, reject) => {
      const tx = persistence.db.transaction('updates', 'readwrite');
      tx.objectStore('updates').count();
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('端末への保存を確認できません'));
    });
  }
  changed();
  return {
    snapshot: () => snapshot(doc), localBarrier,
    textBinding: (id) => ({ text: doc.getMap('rows').get(id).get('text'), undoManager: undo }),
    inputState: (id) => ({ text: doc.getMap('rows').get(id).get('text').toString(), draft: false }),
    queued: () => provider.hasUnsyncedChanges,
    treeState: () => analyzeTree(snapshot(doc)),
    moveBranch(id, parentId, order) {
      const target = movePlacement(snapshot(doc), id, parentId, order);
      const row = doc.getMap('rows').get(id), before = row.get('placement');
      if (before?.parentId === target.parentId && before?.order === target.order) return;
      doc.transact(() => row.set('placement', target), origin);
    },
    setBranchDeleted(id, deleted) {
      const row = doc.getMap('rows').get(id);
      if (!row || typeof deleted !== 'boolean') throw new Error('枝の削除指定が不正です');
      if (!!row.get('deleted') !== deleted) doc.transact(() => row.set('deleted', deleted), origin);
    },
    replaceText: (id, value) => replaceText(doc, id, value, origin),
    insertText(id, index, value) { doc.transact(() => doc.getMap('rows').get(id).get('text').insert(index, value), origin); },
    setAttribute(id, key, value) {
      if (!['favorite', 'completed'].includes(key) || typeof value !== 'boolean') throw new Error('検証対象外の属性です');
      doc.transact(() => doc.getMap('rows').get(id).set(key, value), origin);
    },
    undo: () => undo.undo(), redo: () => undo.redo(),
    async disconnect() {
      if (socket.status === 'disconnected') { socket.disconnect(); return; }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off('status', done); reject(new Error('切断を確認できません')); }, 5000);
        const done = ({ status }) => {
          if (status !== 'disconnected') return;
          clearTimeout(timer); socket.off('status', done); resolve();
        };
        socket.on('status', done); socket.disconnect();
      });
    },
    connect: () => socket.connect(),
    async serverState() {
      const response = await fetch(`/lab/server-state?doc=${encodeURIComponent(docId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('サーバー保存をまだ確認できません');
      return response.json();
    },
    async dispose() { await localBarrier(); provider.destroy(); socket.destroy(); undo.destroy(); await persistence.destroy(); doc.destroy(); },
  };
}
