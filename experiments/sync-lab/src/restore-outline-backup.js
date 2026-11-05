import { readLoroBackup } from './loro-backup.js';
import { restoreLoroJournal } from './loro-journal.js';
import { outlineHandoffKey } from './commit-outline-handoff.js';
import { readOutlineSnapshot } from '../../../src/lib/outline-checkpoint.js';
import { openLoroStorage } from './loro-storage.js';

const sameBytes = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);
export function planLoroRecovery(saved, backup) {
  const doc = restoreLoroJournal(saved);
  try {
    doc.import(backup.snapshot); if (backup.pending) doc.import(backup.pending);
    const ids = new Set();
    for (const node of doc.getTree('outline').getNodes({ withDeleted: true })) {
      const id = node.data.get('id');
      if (id === undefined) continue;
      if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('別の履歴で同じ行が作られているため、自動で復元できません');
      ids.add(id);
    }
    const current = new Map(saved.outbox.map((entry) => [entry.id, entry.bytes]));
    const outgoing = backup.outbox.filter((entry) => {
      const old = current.get(entry.id);
      if (old && !sameBytes(old, entry.bytes)) throw new Error('同じ送信IDに違う内容があるため、復元を中止しました');
      return !old;
    });
    const currentArchives = new Map(saved.archives.map((entry) => [entry.key, entry.value]));
    const here = currentArchives.get('cutover'), there = backup.archives.find((entry) => entry.key === 'cutover')?.value;
    if (here && there && here.migrationId !== there.migrationId) throw new Error('控えと端末の移行世代が違います');
    return { updates: [backup.snapshot, ...(backup.pending ? [backup.pending] : [])], outgoing,
      archives: backup.archives.filter((entry) => !currentArchives.has(entry.key)), cursor: saved.cursor < 0 ? backup.cursor : saved.cursor };
  } finally { doc.free(); }
}

async function checkRecoveryArchives(archives) {
  for (const { key, value } of archives) {
    if (key === 'cutover') continue;
    const source = readOutlineSnapshot(value.archive);
    if (value.format !== 1 || !source || source.legacy || value.key !== key.slice(8)
      || !Array.isArray(value.retained) || await outlineHandoffKey(value.archive) !== value.key) throw new Error('控えの引き継ぎ記録が不正です');
  }
  const capture = archives.find((entry) => entry.key === 'cutover')?.value;
  if (!capture) return;
  const handoff = archives.find((entry) => entry.key === `handoff:${capture.handoffKey}`)?.value;
  if (capture.format !== 1 || capture.phase !== 'complete' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(capture.migrationId)
    || !handoff || JSON.stringify(capture.checkpoint) !== JSON.stringify(handoff.archive)) throw new Error('控えの切替完了記録が揃っていません');
}

// 編集エンジンが閉じ、同じ文書の排他ロックを持つ区間だけで呼ぶ。全件置換で現在の編集を巻き戻さない。
export async function restoreOutlineBackup({ source, ownerId, docId, storageId, activeOwner, signal, openStorage = openLoroStorage }) {
  const active = () => !signal?.aborted && activeOwner() === ownerId && storageId === `owner:${ownerId}:${docId}`;
  const check = () => { signal?.throwIfAborted(); if (!active()) throw new Error('復元する文書の所有者を確認できません'); };
  check();
  if (typeof source !== 'string') throw new Error('控えのJSONファイルが必要です');
  const backup = readLoroBackup(source, { ownerId, docId });
  let storage;
  try {
    await checkRecoveryArchives(backup.archives); check();
    const key = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    storage = await openStorage(storageId); check();
    const previous = await storage.readRecovery(key); check();
    if (previous) {
      if (previous.format !== 1 || previous.key !== key || previous.ownerId !== ownerId || previous.docId !== docId || previous.source !== source) throw new Error('保存済みの復元記録を確認できません');
      return { applied: false, key };
    }
    const saved = await storage.read({ includeArchives: true }); check();
    const plan = planLoroRecovery(saved, backup);
    const receipt = { format: 1, key, ownerId, docId, source, before: saved };
    check(); const applied = await storage.commitRecovery({ receipt, expected: saved, ...plan, active, signal });
    return { applied, key };
  } finally { backup.doc.free(); storage?.close(); }
}
