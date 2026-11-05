import { LoroText } from 'loro-crdt';
import { flattenTree, outlineRowSignature } from '../../../src/lib/outline.js';
import { outlineNodes } from './outline-model.js';
import { loroViewRows } from './loro-model.js';
import { restoreLoroJournal } from './loro-journal.js';
import { planLegacyOutlineHandoff } from './legacy-outline-handoff.js';
import { updateOutlineText } from './loro-text-update.js';

function applyPlan(doc, plan) {
  const tree = doc.getTree('outline'), all = tree.getNodes({ withDeleted: true });
  const nodes = new Map(all.map((node) => [node.data.get('id'), node]));
  const initial = new Map(flattenTree(outlineNodes(loroViewRows(doc))).map((row) => [row.id, row]));
  for (const change of plan.changes) {
    const row = initial.get(change.id);
    if (!row || Object.entries(change.expected).some(([key, value]) => row[key] !== value)) throw new Error('引き継ぐ項目が変わりました');
  }
  for (const command of plan.structures) {
    if (command.kind === 'create' && nodes.has(command.id)) throw new Error('同じ行IDの履歴が既にあります');
    if (command.kind === 'move') {
      const row = initial.get(command.id);
      if (!row || row.parentId !== command.expected.parentId || row.sortOrder !== command.expected.sortOrder) throw new Error('引き継ぐ位置が変わりました');
    }
    if (command.kind === 'delete') {
      for (const row of command.expected) {
        if (outlineRowSignature(initial.get(row.id)) !== outlineRowSignature(row)) throw new Error('削除する枝が変わりました');
      }
    }
  }
  for (const change of plan.changes) {
    const node = nodes.get(change.id);
    for (const [field, value] of Object.entries(change.set)) {
      if (field === 'text') updateOutlineText(node.data.get('text'), value);
      else node.data.set(field, value);
    }
  }
  // 新規親は移動先として先に用意するが、位置は既存行の移動が終わってから決める。
  for (const command of plan.structures.filter((entry) => entry.kind === 'create')) {
    const node = tree.createNode(); nodes.set(command.id, node);
    node.data.set('id', command.id); node.data.setContainer('text', new LoroText()).insert(0, command.row.text);
    for (const [field, value] of Object.entries(command.row)) {
      if (!['id', 'text', 'parentId', 'sortOrder'].includes(field)) node.data.set(field, value);
    }
    node.data.set('deleted', false);
  }
  for (const command of [...plan.structures.filter((entry) => entry.kind !== 'create'), ...plan.structures.filter((entry) => entry.kind === 'create')]) {
    if (command.kind === 'delete') { nodes.get(command.id).data.set('deleted', true); continue; }
    const node = nodes.get(command.id);
    const place = command.placement, parent = place.parentId === null ? undefined : nodes.get(place.parentId);
    if (place.parentId !== null && !parent) throw new Error('引き継ぐ親がありません');
    // 削除印の兄弟もネイティブ位置を占める。表示の番号を直接使わず、現在の兄弟IDから求める。
    const siblings = tree.getNodes({ withDeleted: false }).filter((item) => item.id !== node.id && item.parent()?.id === parent?.id).sort((a, b) => a.index() - b.index());
    const after = siblings.findIndex((item) => item.data.get('id') === place.afterId);
    const before = siblings.findIndex((item) => item.data.get('id') === place.beforeId);
    // 表示順で確定した直前の兄弟を優先し、まだ移動していない次の兄弟に引きずられない。
    const at = after >= 0 ? after + 1 : before >= 0 ? before : place.start ? 0 : siblings.length;
    node.move(parent, at);
  }
  doc.commit({ origin: '旧端末の未送信を一度だけ引き継ぐ' });
}

// 編集エンジンを開く前の排他区間で使う。生きている文書の外から保存を書き換える入口にしない。
// 旧保存の所有者確認と旧書き込み停止を済ませた切替起動だけが接続する。通常の本番起動は変えない。
export async function outlineHandoffKey(checkpoint) {
  const encoded = new TextEncoder().encode(JSON.stringify(checkpoint));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function commitOutlineHandoff({ storage, checkpoint, ownerId, legacyOwnerId, docId, activeOwner, remoteHead }) {
  const active = () => ownerId && legacyOwnerId === ownerId && activeOwner?.() === ownerId
    && storage.id === `owner:${ownerId}:${docId}`;
  if (!docId || !active()) throw new Error('引き継ぐ文書の所有者を確認できません');
  const key = await outlineHandoffKey(checkpoint);
  function checked(receipt) {
    if (!receipt || receipt.format !== 1 || receipt.key !== key || receipt.ownerId !== ownerId || receipt.docId !== docId
      || JSON.stringify(receipt.archive) !== JSON.stringify(checkpoint) || !Array.isArray(receipt.retained)) throw new Error('保存済みの引き継ぎ記録を確認できません');
    return receipt;
  }
  const previous = await storage.readHandoff(key);
  if (!active()) throw new Error('引き継ぎ中に利用者が変わりました');
  if (previous) return { applied: false, receipt: checked(previous) };
  const saved = await storage.read();
  if (!Number.isSafeInteger(remoteHead) || remoteHead < 0 || saved.cursor !== remoteHead
    || saved.base.snapshot === null && !saved.updates.length) throw new Error('新しい文書の最新までの取得と保存が必要です');
  const doc = restoreLoroJournal(saved), updates = [];
  let stop;
  try {
    if (doc.exportPendingUpdates()?.length) throw new Error('新しい文書の先行する差分が未取得です');
    const all = doc.getTree('outline').getNodes({ withDeleted: true });
    const plan = planLegacyOutlineHandoff(checkpoint, outlineNodes(loroViewRows(doc)), { reservedIds: new Set(all.map((node) => node.data.get('id'))) });
    stop = doc.subscribeLocalUpdates((bytes) => updates.push(bytes.slice()));
    applyPlan(doc, plan); stop(); stop = null;
    const outgoing = updates.map((bytes) => ({ id: crypto.randomUUID(), bytes }));
    const receipt = { format: 1, key, ownerId, docId, archive: plan.archive,
      retained: plan.retained, changed: plan.changes.map((change) => change.id), structures: plan.structures, settled: plan.settled };
    if (!active()) throw new Error('引き継ぎ中に利用者が変わりました');
    const applied = await storage.commitHandoff({ receipt, updates, outgoing,
      expected: { generation: saved.base.generation, cutoff: saved.base.cutoff, cursor: saved.cursor, tail: saved.updates.at(-1)?.sequence ?? saved.base.cutoff } });
    return { applied, receipt: applied ? receipt : checked(await storage.readHandoff(key)) };
  } finally { stop?.(); doc.free(); }
}
