import { flattenTree, outlineRowSignature } from '../../../src/lib/outline.js';
import { readOutlineSnapshot } from '../../../src/lib/outline-checkpoint.js';

const fields = ['text', 'collapsed', 'completed', 'favorite', 'date', 'headingLevel', 'textColor', 'bgColor', 'imageWidth'];
const knownKeys = new Set(['id', 'children', 'createdAt', 'updatedAt', ...fields]);

function index(nodes) {
  const ids = new Set();
  function check(list) {
    if (!Array.isArray(list)) throw new Error('引き継ぐアウトラインの形式が不正です');
    for (const node of list) {
      if (!node || typeof node.id !== 'string' || !node.id || ids.has(node.id) || typeof node.text !== 'string') {
        throw new Error('引き継ぐ行IDか本文が不正です');
      }
      ids.add(node.id); check(node.children ?? []);
    }
  }
  check(nodes);
  return new Map(flattenTree(nodes).map((row) => [row.id, row]));
}

function baseline(operation) {
  try {
    const row = JSON.parse(operation.baseSignature);
    if (!row || row.id !== operation.id || !fields.every((field) => Object.hasOwn(row, field))
      || !(row.parentId === null || typeof row.parentId === 'string') || !Number.isFinite(row.sortOrder)) return null;
    if (typeof row.text !== 'string' || ['collapsed', 'completed', 'favorite'].some((field) => typeof row[field] !== 'boolean')) return null;
    return row;
  } catch { return null; }
}

// 旧JSONにはCRDTの操作履歴がない。移行時だけ旧キューの基準値を使って編集列を取り出し、
// 古い端末の全文や位置を「最新に対する操作」として作り直さない。日常の同期には使わない。
// これは副作用のない候補作成。実適用には所有者確認・expectedの再検査・原本と処理済み印の
// 一体保存が必要で、候補を作っただけで旧キューを消したり、通信したりしない。
export function planLegacyOutlineHandoff(checkpoint, latest) {
  const local = index(checkpoint?.nodes), current = index(latest);
  const saved = readOutlineSnapshot(checkpoint);
  if (!saved || saved.legacy) throw new Error('未送信の記録を含む旧保存が必要です');
  const plan = { format: 'taskspace-outline-handoff/1', archive: structuredClone(checkpoint), changes: [], settled: [], retained: [] };
  const unsupported = new Map();
  function inspect(nodes) {
    for (const node of nodes) {
      const unknown = Object.keys(node).filter((key) => !knownKeys.has(key));
      if (unknown.length) unsupported.set(node.id, unknown);
      inspect(node.children ?? []);
    }
  }
  inspect(saved.nodes);
  for (const operation of saved.sync.pending) {
    const here = local.get(operation.id), there = current.get(operation.id);
    if (unsupported.has(operation.id)) {
      plan.retained.push({ id: operation.id, reason: 'unsupported-fields', fields: unsupported.get(operation.id) });
      continue;
    }
    if (operation.kind === 'delete') {
      if (!there) plan.settled.push(operation.id);
      else plan.retained.push({ id: operation.id, reason: 'structure' });
      continue;
    }
    if (!there) {
      plan.retained.push({ id: operation.id, reason: 'missing-target' });
      continue;
    }
    const base = baseline(operation);
    if (!base) {
      // 返事喪失後に結果だけ一致している場合も、列と位置の一致以外を推測しない。
      if (fields.every((field) => here[field] === there[field])
        && here.parentId === there.parentId && here.sortOrder === there.sortOrder) plan.settled.push(operation.id);
      else plan.retained.push({ id: operation.id, reason: 'missing-base' });
      continue;
    }
    const set = {}, expected = {}, conflicts = [];
    for (const field of fields) {
      if (here[field] === base[field] || here[field] === there[field]) continue;
      if (there[field] === base[field]) { set[field] = here[field]; expected[field] = there[field]; }
      else conflicts.push(field);
    }
    const moved = operation.positionChanged !== false
      && (here.parentId !== base.parentId || here.sortOrder !== base.sortOrder)
      && (here.parentId !== there.parentId || here.sortOrder !== there.sortOrder);
    if (moved) plan.retained.push({ id: operation.id, reason: 'structure' });
    if (conflicts.length) plan.retained.push({ id: operation.id, reason: 'field-conflict', fields: conflicts });
    if (Object.keys(set).length) {
      // 遠隔の別項目が更新した時刻を巻き戻さず、時刻だけの差で確認を要求しない。
      const beforeTime = JSON.parse(outlineRowSignature(base)).updatedAt;
      const latestTime = JSON.parse(outlineRowSignature(there)).updatedAt;
      if (beforeTime === latestTime && typeof here.updatedAt === 'string' && Number.isFinite(Date.parse(here.updatedAt)) && here.updatedAt !== there.updatedAt) {
        set.updatedAt = here.updatedAt; expected.updatedAt = there.updatedAt;
      }
      plan.changes.push({ id: operation.id, set, expected });
    } else if (!moved && !conflicts.length) plan.settled.push(operation.id);
  }
  return plan;
}
