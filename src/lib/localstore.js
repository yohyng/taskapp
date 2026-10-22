import { buildTree } from "./outline.js";
import { OUTLINE_FORMAT, readOutlineSnapshot, outlineRowDelta } from "./outline-checkpoint.js";

// この端末の置き場。
// localStorage は 5MB ほどで頭打ちになり、大きなアウトラインは入らない。
// （iPad で「この端末に置ききれませんでした」と出るのがこれ）
// そこで、大きいものは IndexedDB に置く。localStorage へは入るときだけ写す。

const DB = "taskspace";
const STORE = "big";

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("この端末には置き場がありません")); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("置き場を開けません"));
  });
}

async function withStore(mode, run) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let req;
      let failure;
      // 要求が成功しても、そのあとの容量不足や中断で全体が取り消される。
      // complete まで待ち、要求の失敗も最後の abort で受け取る。
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error || failure || new Error("置き場への処理が中断されました"));
      try {
        req = run(tx.objectStore(STORE));
      } catch (error) {
        // データの複製などで要求を作れなかったときも、取引を残さない。
        failure = error;
        tx.abort();
      }
    });
  } finally { db.close(); }
}

// 起動時は「無い」と「読めない」を区別しないと、本物へ空の木を上書きしてしまう。
export async function bigGet(key, { throwOnError = false } = {}) {
  try {
    if (key === OUTLINE_KEY) return await readOutlineRows();
    return await withStore("readonly", (store) => store.get(key));
  }
  catch (error) {
    if (throwOnError) throw error;
    return undefined;
  }
}

export async function bigPut(key, value) {
  try {
    if (key === OUTLINE_KEY && value?.format === OUTLINE_FORMAT) return await writeOutlineRows(value);
    await withStore("readwrite", (store) => store.put(value, key)); return true;
  }
  catch { return false; }
}

export async function bigDelete(key) {
  try {
    if (key === OUTLINE_KEY) {
      await withStore("readwrite", (store) => {
        store.delete(OUTLINE_KEY);
        const cursor = store.openKeyCursor(IDBKeyRange.bound([OUTLINE_KEY, "row"], [OUTLINE_KEY, "row", []]));
        cursor.onsuccess = () => { if (cursor.result) { store.delete(cursor.result.primaryKey); cursor.result.continue(); } };
        return store.delete(META_KEY);
      });
      outlineBase = null;
      return true;
    }
    await withStore("readwrite", (store) => store.delete(key)); return true;
  }
  catch { return false; }
}

const OUTLINE_KEY = "taskspace-outline-v1";
const ROW_FORMAT = "taskspace-outline/rows/1";
const META_KEY = [OUTLINE_KEY, "meta"];
const rowKey = (id) => [OUTLINE_KEY, "row", id];
let outlineBase = null;

// 行と同期記録は同じreadonly取引から読む。旧スナップショットは移行後も控えとして残す。
async function readOutlineRows() {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      let value, failure, count = null;
      tx.oncomplete = () => {
        if (value?.format === OUTLINE_FORMAT && count !== null) outlineBase = { nodes: value.nodes, revision: value.revision, count };
        else outlineBase = null;
        resolve(value);
      };
      tx.onabort = () => reject(tx.error || failure || new Error("行の読み出しが中断されました"));
      const meta = store.get(META_KEY);
      meta.onsuccess = () => {
        if (!meta.result) {
          const old = store.get(OUTLINE_KEY);
          old.onsuccess = () => { value = old.result; };
          return;
        }
        try {
          const saved = meta.result;
          if (saved.storage !== ROW_FORMAT || saved.format !== OUTLINE_FORMAT || !Number.isSafeInteger(saved.count) || saved.count < 0) throw new Error("行の保存形式を読めません");
          const rows = store.getAll(IDBKeyRange.bound([OUTLINE_KEY, "row"], [OUTLINE_KEY, "row", []]));
          rows.onsuccess = () => {
            try {
              if (rows.result.length !== saved.count || new Set(rows.result.map((row) => row.id)).size !== saved.count) throw new Error("保存済みの行が揃っていません");
              const { count: size, ...record } = saved;
              count = size;
              value = readOutlineSnapshot({ ...record, nodes: buildTree(rows.result) });
            } catch (error) { failure = error; tx.abort(); }
          };
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  } finally { db.close(); }
}

async function writeOutlineRows(record) {
  if (!outlineBase) await readOutlineRows();
  const base = outlineBase;
  const delta = outlineRowDelta(base?.nodes || null, record.nodes);
  const { nodes, ...header } = record;
  // 本文をメタデータに混ぜると、1行の編集でもまた全体を複製してしまう。
  const meta = { ...header, storage: ROW_FORMAT, count: delta.count ?? base.count };
  const db = await open();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      let failure;
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || failure || new Error("行の保存が中断されました"));
      const current = store.get(META_KEY);
      current.onsuccess = () => {
        try {
          // 別の書き手が先に確定した古い基準では更新しない。
          if ((current.result && (current.result.storage !== ROW_FORMAT || current.result.format !== OUTLINE_FORMAT || current.result.count !== base?.count)) || (current.result?.revision ?? null) !== (base?.revision ?? null)
            || (current.result && record.revision <= current.result.revision)) throw new Error("保存済みの世代が変わりました");
          for (const id of delta.gone) store.delete(rowKey(id));
          for (const row of delta.rows) store.put(row, rowKey(row.id));
          store.put(meta, META_KEY);
        } catch (error) { failure = error; tx.abort(); }
      };
    });
    outlineBase = { nodes, revision: record.revision, count: meta.count };
    return true;
  } finally { db.close(); }
}
