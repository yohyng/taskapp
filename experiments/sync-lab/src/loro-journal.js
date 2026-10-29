import { LoroDoc } from 'loro-crdt';
import { loroCheckpoint, restoreLoroCheckpoint } from './loro-model.js';

// 基準のsnapshot、その時点で未適用の受信、以降の生バイナリを順に戻す。
// 未適用の更新もログに残るので、後から前提が届けばLoro自身が適用できる。
export function restoreLoroJournal(saved) {
  const doc = saved.base.snapshot === null ? new LoroDoc() : restoreLoroCheckpoint(saved.base);
  try {
    for (const entry of saved.updates) doc.import(entry.bytes);
    return doc;
  } catch (error) { doc.free(); throw error; }
}

export function checkpointLoroJournal(saved) {
  const doc = restoreLoroJournal(saved);
  try { return loroCheckpoint(doc); } finally { doc.free(); }
}
