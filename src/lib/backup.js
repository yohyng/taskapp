import { readOutlineSnapshot } from "./outline-checkpoint.js";

const OUTLINE_KEY = "taskspace-outline-v1";
const TASK_KEY = "notion-like-taskdb-prototype-v4";

// JSONとして読めるだけでは復元に使えない。大きい本文と送信記録も揃っていることを確かめる。
export function readTaskspaceBackup(value) {
  const payload = typeof value === "string" ? JSON.parse(value) : value;
  if (!payload || payload.app !== "taskspace" || !payload.store
    || typeof payload.store !== "object" || Array.isArray(payload.store)) throw new Error("Task Spaceの控えを読めません");
  if (typeof payload.store[OUTLINE_KEY] !== "string") throw new Error("控えにアウトラインがありません");
  const outline = readOutlineSnapshot(JSON.parse(payload.store[OUTLINE_KEY]));
  if (!outline) throw new Error("控えのアウトラインを読めません");
  if (payload.store[TASK_KEY] !== undefined) JSON.parse(payload.store[TASK_KEY]);
  return { payload, outline };
}

export function collectTaskspaceBackup(storage, outline) {
  if (!outline) throw new Error("保存済みの内容を確認できていません");
  const store = {};
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) throw new Error("読み出し中に内容が変わりました");
      if (key === "taskspace-drive-token") continue;
      if (!/^(taskspace-|notion-like-taskdb|ts-)/.test(key)) continue;
      const value = storage.getItem(key);
      if (typeof value !== "string") throw new Error("読み出し中に内容が変わりました");
      store[key] = value;
    }
  } catch {
    // タスクや設定を読めなかった控えで、正常な以前の控えを押し出さない。
    throw new Error("端末のデータを読み出せなかったため、控えを中止しました");
  }
  // IndexedDBだけにある本文も、画面の最新の姿と送信記録をひとまとめに残す。
  store[OUTLINE_KEY] = JSON.stringify(outline);
  const payload = { app: "taskspace", at: new Date().toISOString(), store };
  readTaskspaceBackup(payload);
  return payload;
}
