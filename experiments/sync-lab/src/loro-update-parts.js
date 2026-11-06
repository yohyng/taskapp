import { decodeImportBlobMeta } from 'loro-crdt';

export const LOG_UPDATE_BYTES = 65536;

// バイト列を途中で切らず、同じ操作IDの範囲をLoro自身に書き出させる。
// 本文の再入力やcommitを追加しないので、一回の貼り付けのUndoと遠隔の履歴を保てる。
export function splitLoroUpdate(doc, bytes) {
  if (bytes.length <= LOG_UPDATE_BYTES) return [bytes];
  const metadata = decodeImportBlobMeta(bytes, true), parts = [];
  try {
    if (metadata.mode !== 'update') throw new Error('送信待ちの差分形式が不正です');
    const starts = metadata.partialStartVersionVector.toJSON();
    function emit(peer, counter, len) {
      const part = doc.export({ mode: 'updates-in-range', spans: [{ id: { peer, counter }, len }] });
      if (part.length <= LOG_UPDATE_BYTES) { parts.push(part); return; }
      if (len === 1) throw new Error('分割できない大きな属性があります');
      const half = Math.floor(len / 2);
      emit(peer, counter, half); emit(peer, counter + half, len - half);
    }
    for (const [peer, end] of metadata.partialEndVersionVector.toJSON()) {
      const start = starts.get(peer) || 0;
      // 大きな履歴を丸ごと何度も書き出さず、最初から有限の操作範囲にする。
      for (let counter = start; counter < end; counter += 16384) emit(peer, counter, Math.min(16384, end - counter));
    }
    if (!parts.length) throw new Error('送信待ちの操作範囲がありません');
    return parts;
  } finally { metadata.partialStartVersionVector.free(); metadata.partialEndVersionVector.free(); }
}

export function prepareLogEntry(entry, doc) {
  if (!entry || entry.bytes.length <= LOG_UPDATE_BYTES) return null;
  return splitLoroUpdate(doc, entry.bytes).map((bytes) => ({ id: crypto.randomUUID(), bytes }));
}
