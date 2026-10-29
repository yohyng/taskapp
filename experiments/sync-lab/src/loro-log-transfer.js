import { decodeImportBlobMeta, LoroDoc } from 'loro-crdt';

export function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function binary(text, kind) {
  if (typeof text !== 'string' || !text.length) throw new Error('受信差分が不正です');
  const bytes = Uint8Array.from(atob(text.replaceAll('\n', '')), (value) => value.charCodeAt(0));
  const meta = decodeImportBlobMeta(bytes, true);
  try { if (meta.mode !== kind) throw new Error('受信差分の種類が違います'); }
  finally { meta.partialStartVersionVector.free(); meta.partialEndVersionVector.free(); }
  return bytes;
}
export function logBatch(outbox) {
  const batch = []; let size = 0;
  for (const entry of outbox) {
    if (entry.bytes.length > 65536) throw new Error('一つの編集が送信上限を超えています');
    if (batch.length === 32 || size + entry.bytes.length > 262144) break;
    batch.push(entry); size += entry.bytes.length;
  }
  return batch;
}
// 返事の全体を確かめてから本文へ適用する。ACKだけ先に採らず、取得位置と同じ端末取引に残す。
export function decodeLogTransfer(result, _bootstrap, { cursor, batch }) {
  if (!Number.isSafeInteger(result?.cursor) || !Number.isSafeInteger(result.head) || result.cursor < Math.max(0, cursor)
    || result.head < result.cursor || !Array.isArray(result.updates) || result.updates.length > 32
    || JSON.stringify(result.acknowledged) !== JSON.stringify(batch.map((entry) => entry.id))) throw new Error('差分の確認応答が不正です');
  const updates = [];
  if (cursor === -1) updates.push(binary(result.snapshot, 'snapshot'));
  else if (result.snapshot !== null) throw new Error('要求していない初回文書です');
  let sequence = Math.max(0, cursor);
  for (const entry of result.updates) {
    if (entry.sequence !== ++sequence) throw new Error('受信した差分に抜けがあります');
    updates.push(binary(entry.bytes, 'update'));
  }
  if (sequence !== result.cursor) throw new Error('取得位置と差分が一致しません');
  const candidate = new LoroDoc();
  try { for (const bytes of updates) candidate.import(bytes); } finally { candidate.free(); }
  return { mode: cursor === -1 ? 'snapshot' : 'update', updates, cursor: result.cursor, more: result.head > result.cursor };
}
