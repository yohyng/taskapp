import { LoroDoc, LoroText } from 'loro-crdt';
import { compareRows } from './tree-model.js';

// 共通の合成文書を一度だけ作り、端末はこのバイナリを受け取る。起動時のJSON再構築はしない。
export function fixtureLoroDocument(count = 30) {
  const doc = new LoroDoc();
  doc.setPeerId('1');
  const tree = doc.getTree('outline'), nodes = new Map();
  tree.enableFractionalIndex(0);
  for (let i = 0; i < count; i++) {
    const node = tree.createNode(i > 2 && i < 10 ? nodes.get('row-1').id : undefined);
    const id = `row-${i}`; nodes.set(id, node);
    node.data.set('id', id);
    node.data.setContainer('text', new LoroText()).insert(0, i === 0 ? '最初のメモ' : `検証用の行 ${i}`);
    for (const field of ['favorite', 'completed', 'deleted']) node.data.set(field, false);
  }
  doc.commit({ origin: 'fixture' });
  return doc;
}

export function loroNode(doc, id) {
  const matches = doc.getTree('outline').getNodes({ withDeleted: false }).filter((node) => node.data.get('id') === id);
  if (matches.length !== 1) throw new Error('行IDが一意に見つかりません');
  return matches[0];
}

// 表示のために親を書き換えない。木の順序・親子はLoroTree自身の結果をそのまま読む。
export function loroRows(doc, { withNativeDeleted = false } = {}) {
  const nodes = doc.getTree('outline').getNodes({ withDeleted: true });
  const byNativeId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => withNativeDeleted || !node.isDeleted()).map((node) => ({
    id: node.data.get('id'), nativeId: node.id,
    parentId: byNativeId.get(node.parent()?.id)?.data.get('id') ?? null,
    order: node.index() ?? -1,
    text: node.data.get('text')?.toString() ?? '',
    favorite: !!node.data.get('favorite'), completed: !!node.data.get('completed'),
    deleted: !!node.data.get('deleted'), nativeDeleted: node.isDeleted(),
  })).sort(compareRows);
}

export const loroViewRows = (doc) => loroRows(doc).map(({ nativeId, nativeDeleted, ...row }) => row);

// 因果上の先行更新を待つ受信内容は通常のsnapshotに入らない。両方を同じ世代として保持する。
// ここは同期的なバイナリ作成だけ。IndexedDBへの取引・通信の完了を保証するAPIではない。
export function loroCheckpoint(doc) {
  return { snapshot: doc.export({ mode: 'snapshot' }), pending: doc.exportPendingUpdates() ?? null };
}

export function restoreLoroCheckpoint(checkpoint) {
  const doc = new LoroDoc();
  try {
    doc.import(checkpoint.snapshot);
    if (checkpoint.pending !== null) doc.import(checkpoint.pending);
    return doc;
  } catch (error) { doc.free(); throw error; }
}
