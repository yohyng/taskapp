import { decodeImportBlobMeta, LoroDoc } from 'loro-crdt';
import { loroCheckpoint } from './loro-model.js';

export function loroSyncRequest(doc, outbox) {
  const version = doc.oplogVersion();
  try {
    return {
      version: [...version.encode()], updates: outbox.map((entry) => [...entry.bytes]),
      // 前提待ちの受信だけを持つ端末も「空」と扱わない。起動し直すたびの全体配信を防ぐ。
      bootstrap: version.length() === 0 && outbox.length === 0 && !doc.exportPendingUpdates()?.length,
    };
  } finally { version.free(); }
}

export function exportLoroTransfer(doc, from, bootstrap) {
  if (bootstrap) {
    if (from.length() !== 0) throw new Error('初回文書の要求に既存の履歴があります');
    const saved = loroCheckpoint(doc);
    // snapshotには前提待ちの受信が含まれないため、別の部分として同じ応答へ残す。
    return { mode: 'snapshot', update: [...saved.snapshot], pending: saved.pending && [...saved.pending] };
  }
  return { mode: 'update', update: [...doc.export({ mode: 'update', from })] };
}

function decodePart(value, expected) {
  if (!Array.isArray(value) || !value.length || !value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new Error('受信した文書の形式が不正です');
  const bytes = Uint8Array.from(value), meta = decodeImportBlobMeta(bytes, true);
  try {
    if (meta.mode !== expected) throw new Error('受信した文書の種類が一致しません');
    return bytes;
  } finally { meta.partialStartVersionVector.free(); meta.partialEndVersionVector.free(); }
}

export function decodeLoroTransfer(result, requestedBootstrap) {
  const mode = result?.mode === undefined ? 'update' : result.mode;
  if (!['snapshot', 'update'].includes(mode) || (mode === 'snapshot' && !requestedBootstrap)) throw new Error('要求していない初回文書を受信しました');
  const updates = [decodePart(result?.update, mode)];
  if (mode === 'snapshot') {
    if (result.pending !== null) updates.push(decodePart(result.pending, 'update'));
  } else if (result.pending != null) throw new Error('差分応答に初回文書の待機部分があります');
  if (mode === 'snapshot') {
    const candidate = new LoroDoc();
    try { for (const bytes of updates) candidate.import(bytes); } finally { candidate.free(); }
  }
  // どの部分もCRCと種類を確認してから原本へ渡す。壊れた後半で前半だけを適用しない。
  return { mode, updates };
}
