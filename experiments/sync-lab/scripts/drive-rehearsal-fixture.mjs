import { randomUUID } from 'node:crypto';
import { seedOutlineDocument } from '../src/outline-model.js';
import { loroCheckpoint, loroNode } from '../src/loro-model.js';
import { collectLoroBackup } from '../src/loro-backup.js';
import { outlineCheckpoint } from '../../../src/lib/outline-checkpoint.js';
import { outlineHandoffKey } from '../src/commit-outline-handoff.js';

export const rehearsalPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=';
// 利用者の本文を入力に受け取らず、画像参照・旧原本・未送信を持つ小さい共通履歴を作る。
export async function driveRehearsalBackup(imageUrl) {
  const scope = { ownerId: randomUUID(), docId: randomUUID() };
  const nodes = [{ id: 'memo', text: '日本語の控え🌿', children: [] }, { id: 'image', text: `![](${imageUrl})`, imageWidth: 321, children: [] }];
  const checkpoint = outlineCheckpoint(nodes, { sequence: 0, pending: new Map() }, new Set(), new Set(['memo', 'image']), 1, '2026-11-06');
  const key = await outlineHandoffKey(checkpoint), migrationId = randomUUID();
  const archives = [
    { key: 'cutover', value: { format: 1, ...scope, migrationId, phase: 'complete', checkpoint, handoffKey: key, originals: { localRaw: JSON.stringify(checkpoint) } } },
    { key: `handoff:${key}`, value: { format: 1, key, ...scope, archive: checkpoint, retained: [] } },
  ];
  const doc = seedOutlineDocument(nodes);
  try {
    const base = { ...loroCheckpoint(doc), format: 2, generation: 1, cutoff: 0 }, updates = [], outbox = [];
    const stop = doc.subscribeLocalUpdates((bytes) => { updates.push({ sequence: updates.length + 1, bytes }); outbox.push({ id: randomUUID(), bytes }); });
    loroNode(doc, 'memo').data.get('text').insert(0, '未送信の追記：'); doc.commit(); stop();
    const values = { 'notion-like-taskdb-prototype-v4': '{"tasks":[{"id":"task","title":"検証用タスク"}]}',
      'taskspace-font': 'mincho', 'taskspace-drive-token': '控えへ含めない', 'taskspace-lab-auth-synthetic': '控えへ含めない' };
    const storage = { length: Object.keys(values).length, key: (at) => Object.keys(values)[at], getItem: (name) => values[name] };
    return { scope, payload: collectLoroBackup(storage, { base, updates, outbox, cursor: 0, archives }, scope) };
  } finally { doc.free(); }
}
