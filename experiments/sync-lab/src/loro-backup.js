import { decodeImportBlobMeta, LoroDoc } from 'loro-crdt';
import { collectTaskspaceBackup, readTaskspaceBackup } from '../../../src/lib/backup.js';
import { restoreLoroJournal } from './loro-journal.js';
import { loroCheckpoint, loroViewRows } from './loro-model.js';
import { outlineNodes } from './outline-model.js';
import { base64 } from './loro-log-transfer.js';

const format = 'taskspace-loro-backup/1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function checkScope(ownerId, docId) {
  if (!uuid.test(ownerId) || !uuid.test(docId)) throw new Error('控えの所有者と文書を確認できません');
}
function bytes(text, kind) {
  if (typeof text !== 'string' || !text.length) throw new Error('控えの同期履歴が欠けています');
  const value = Uint8Array.from(atob(text), (item) => item.charCodeAt(0));
  if (base64(value) !== text) throw new Error('控えの同期履歴を読めません');
  const meta = decodeImportBlobMeta(value, true);
  try { if (meta.mode !== kind) throw new Error('控えの同期履歴の種類が違います'); }
  finally { meta.partialStartVersionVector.free(); meta.partialEndVersionVector.free(); }
  return value;
}
function checkArchives(archives, ownerId, docId) {
  if (!Array.isArray(archives)) throw new Error('控えの引き継ぎ原本が欠けています');
  const keys = new Set();
  for (const entry of archives) {
    if (!entry || typeof entry.key !== 'string' || keys.has(entry.key) || !(entry.key === 'cutover' || /^handoff:[a-f0-9]{64}$/.test(entry.key))
      || entry.value?.ownerId !== ownerId || entry.value?.docId !== docId) throw new Error('控えの引き継ぎ原本を確認できません');
    keys.add(entry.key);
  }
}

// JSONの表示用の木から新しい履歴を作らない。保存済み文書・未送信・移行原本を一緒に持ち出す。
export function collectLoroBackup(storage, saved, { ownerId, docId }) {
  checkScope(ownerId, docId);
  if (!Number.isSafeInteger(saved?.cursor) || saved.cursor < 0) throw new Error('本文の初回取得が終わっていません');
  checkArchives(saved.archives, ownerId, docId);
  const doc = restoreLoroJournal(saved);
  try {
    const checkpoint = loroCheckpoint(doc);
    const keys = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (typeof key !== 'string' || !key) throw new Error('端末のデータを読み出せなかったため、控えを中止しました');
      // 検証用SDKのセッション名もtaskspaceで始まる。再ログイン用の鍵をDriveへ持ち出さない。
      if (!key.startsWith('taskspace-lab-auth-')) keys.push(key);
    }
    const payload = collectTaskspaceBackup({ length: keys.length, key: (index) => keys[index], getItem: (key) => storage.getItem(key) }, outlineNodes(loroViewRows(doc)));
    payload.outlineSync = { format, ownerId, docId, cursor: saved.cursor,
      snapshot: base64(checkpoint.snapshot), pending: checkpoint.pending === null ? null : base64(checkpoint.pending),
      outbox: saved.outbox.map((entry) => ({ id: entry.id, bytes: base64(entry.bytes) })), archives: structuredClone(saved.archives) };
    const checked = readLoroBackup(payload, { ownerId, docId }); checked.doc.free();
    return payload;
  } finally { doc.free(); }
}

// 別の文書へ読み戻してから復元候補として扱う。現在の端末保存やサーバーには触れない。
export function readLoroBackup(value, { ownerId, docId }) {
  checkScope(ownerId, docId);
  const { payload, outline } = readTaskspaceBackup(value), record = payload.outlineSync;
  if (record?.format !== format || record.ownerId !== ownerId || record.docId !== docId
    || !Number.isSafeInteger(record.cursor) || record.cursor < 0 || !Array.isArray(record.outbox)) throw new Error('この文書の同期履歴付きの控えではありません');
  checkArchives(record.archives, ownerId, docId);
  const snapshot = bytes(record.snapshot, 'snapshot'), pending = record.pending === null ? null : bytes(record.pending, 'update');
  const doc = new LoroDoc();
  try {
    doc.import(snapshot); if (pending) doc.import(pending);
    const nodes = outlineNodes(loroViewRows(doc));
    if (JSON.stringify(nodes) !== JSON.stringify(outline.nodes)) throw new Error('控えの本文と同期履歴が一致しません');
    const version = base64(doc.oplogVersion().encode()), waiting = base64(doc.exportPendingUpdates() || new Uint8Array());
    const seen = new Set(), outbox = record.outbox.map((entry) => {
      if (!entry || !uuid.test(entry.id) || seen.has(entry.id)) throw new Error('控えの送信待ちIDが不正です');
      seen.add(entry.id); return { id: entry.id, bytes: bytes(entry.bytes, 'update') };
    });
    for (const entry of outbox) doc.import(entry.bytes);
    if (base64(doc.oplogVersion().encode()) !== version || base64(doc.exportPendingUpdates() || new Uint8Array()) !== waiting) throw new Error('控えの送信待ちと同期履歴が一致しません');
    return { payload, doc, nodes, snapshot, pending, outbox, cursor: record.cursor, archives: structuredClone(record.archives) };
  } catch (error) { doc.free(); throw error; }
}
