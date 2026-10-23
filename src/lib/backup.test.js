import { describe, it, expect } from "vitest";
import { collectTaskspaceBackup, readTaskspaceBackup } from "./backup.js";
import { ensureNode } from "./outline.js";
import { outlineCheckpoint, queueOutlineRows } from "./outline-checkpoint.js";

const store = (values) => ({ length: Object.keys(values).length, key: (i) => Object.keys(values)[i], getItem: (key) => values[key] });
const checkpoint = () => outlineCheckpoint([ensureNode({ id: "a", text: "手元の本文" })],
  queueOutlineRows({ sequence: 0, pending: new Map() }, [{ id: "a", kind: "put" }, { id: "b", kind: "delete" }]),
  new Set(["b"]), new Set(["b"]), 3, "2026-10-23T00:00:00Z");

describe("全体の控えに復元できる内容を揃える", () => {
  it("IndexedDBだけの本文・送信待ち・削除・タスク・設定を一緒に読み戻せる", () => {
    const outline = checkpoint();
    const values = { "notion-like-taskdb-prototype-v4": JSON.stringify({ tasks: [{ id: "task-a", title: "タスク" }] }),
      "taskspace-font": "mincho", "taskspace-drive-token": "合言葉", unrelated: "対象外" };
    const got = readTaskspaceBackup(JSON.stringify(collectTaskspaceBackup(store(values), outline)));
    expect(got.outline).toEqual(outline);
    expect(got.payload.store).toEqual({ "notion-like-taskdb-prototype-v4": values["notion-like-taskdb-prototype-v4"],
      "taskspace-font": "mincho", "taskspace-outline-v1": JSON.stringify(outline) });
  });
  it("読み込み途中の本文を控えとして確定しない", () => {
    expect(() => collectTaskspaceBackup(store({}), null)).toThrow("確認できていません");
  });
  it("途中で読めないデータがある場合、部分的な控えを返さない", () => {
    const storage = store({ "taskspace-font": "sans", "notion-like-taskdb-prototype-v4": "{}" });
    storage.getItem = (key) => { if (key.includes("taskdb")) throw new Error("読み出し失敗"); return "sans"; };
    expect(() => collectTaskspaceBackup(storage, checkpoint())).toThrow("控えを中止");
  });
  it.each([{}, { app: "taskspace", store: {} }, { app: "taskspace", store: { "taskspace-outline-v1": "{}" } },
    { app: "taskspace", store: { "taskspace-outline-v1": "[]", "notion-like-taskdb-prototype-v4": "{" } }])("不完全な控えを読み戻せると判断しない: %j", (value) => {
    expect(() => readTaskspaceBackup(value)).toThrow();
  });
  it("以前の配列形式と、本当に空のアウトラインも読める", () => {
    expect(readTaskspaceBackup({ app: "taskspace", store: { "taskspace-outline-v1": "[]" } }).outline).toEqual({ nodes: [], legacy: true });
  });
});
