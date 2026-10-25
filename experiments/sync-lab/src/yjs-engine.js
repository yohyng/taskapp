import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { replaceText, snapshot } from './model.js';

export async function createEngine({ docId, offline, onChange }) {
  const doc = new Y.Doc();
  const origin = { device: 'このブラウザーの編集' };
  const persistence = new IndexeddbPersistence(`taskspace-lab-yjs-${docId}`, doc);
  await persistence.whenSynced;
  const undo = new Y.UndoManager(doc.getMap('rows'), { trackedOrigins: new Set([origin]), captureTimeout: 0 });
  const provider = new HocuspocusProvider({
    url: 'ws://127.0.0.1:4181', name: docId, document: doc, connect: !offline, awareness: null,
  });
  let connected = false;
  const changed = () => onChange?.({ rows: snapshot(doc), connected, queued: provider.hasUnsyncedChanges });
  provider.on('status', ({ status }) => { connected = status === 'connected'; changed(); });
  provider.on('synced', changed);
  provider.on('unsyncedChanges', changed);
  doc.on('update', changed);
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
    replaceText: (id, value) => replaceText(doc, id, value, origin),
    insertText(id, index, value) { doc.transact(() => doc.getMap('rows').get(id).get('text').insert(index, value), origin); },
    setAttribute(id, key, value) {
      if (!['favorite', 'completed'].includes(key) || typeof value !== 'boolean') throw new Error('検証対象外の属性です');
      doc.transact(() => doc.getMap('rows').get(id).set(key, value), origin);
    },
    undo: () => undo.undo(), redo: () => undo.redo(),
    disconnect: () => provider.disconnect(), connect: () => provider.connect(),
    async serverState() {
      const response = await fetch(`/lab/server-state?doc=${encodeURIComponent(docId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('サーバー保存をまだ確認できません');
      return response.json();
    },
    async dispose() { await localBarrier(); provider.destroy(); undo.destroy(); await persistence.destroy(); doc.destroy(); },
  };
}
