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
      const req = run(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

export async function bigGet(key) {
  try { return await withStore("readonly", (store) => store.get(key)); }
  catch { return undefined; }
}

export async function bigPut(key, value) {
  try { await withStore("readwrite", (store) => store.put(value, key)); return true; }
  catch { return false; }
}

export async function bigDelete(key) {
  try { await withStore("readwrite", (store) => store.delete(key)); return true; }
  catch { return false; }
}
