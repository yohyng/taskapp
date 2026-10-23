import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

import { createGas as gas } from "../../tests/fixtures/gas-backup.js";
const payload = () => ({ app: "taskspace", at: "2026-10-23T00:00:00Z", store: {
  "taskspace-outline-v1": JSON.stringify([{ id: "a", text: "日本語と絵文字🌿", children: [] }]),
  "notion-like-taskdb-prototype-v4": JSON.stringify({ tasks: [{ id: "task-a", title: "タスク" }] }),
} });
const digest = (text) => createHash("sha256").update(text).digest("hex");

describe("実際のGASソースで控えを検証する", () => {
  it.each(["json", "gzip"])("%sを保存し、読み直した本文の照合結果を返す", (format) => {
    const api = gas(), text = JSON.stringify(payload());
    const sent = format === "json" ? { json: text } : { gzipBase64: gzipSync(text).toString("base64") };
    const got = api.post({ ...sent, expectedBytes: text.length, expectedSha256: digest(text) });
    expect(got).toMatchObject({ ok: true, id: "new-backup", bytes: text.length, sha256: digest(text) });
    expect(api.readbacks).toEqual([text]);
    expect(JSON.parse(api.created[0].text)).toEqual(payload());
  });
  it.each([
    ["本文なし", {}], ["空のJSON", { json: "{}" }], ["壊れたJSON", { json: "{" }],
    ["長さの不一致", { json: JSON.stringify(payload()), expectedBytes: 1 }],
    ["同じ長さの別内容", { json: JSON.stringify(payload()), expectedSha256: "0".repeat(64) }],
    ["壊れた圧縮", { gzipBase64: "invalid" }],
  ])("%sを受け取ってもファイルを作らず、前の控えを削除しない", (_name, body) => {
    const api = gas();
    expect(api.post(body).error).toBeTruthy();
    expect(api.created).toEqual([]);
    expect(api.trashed).toEqual([]);
  });
  it("保存後の読み直しが違えば、古い控えを削除せず成功も返さない", () => {
    const api = gas({ corruptReadback: true }), text = JSON.stringify(payload());
    expect(api.post({ json: text, expectedBytes: text.length, expectedSha256: digest(text) }).error).toBeTruthy();
    expect(api.trashed.filter((id) => typeof id === "number")).toEqual([]);
  });
  it("以前のアプリの控えも、検証後に互換の返事を返せる", () => {
    const api = gas(), text = JSON.stringify(payload());
    expect(api.post({ json: text, expectedBytes: text.length })).toMatchObject({ ok: true, bytes: text.length });
  });
  it("送信前に、控えの検証に対応していると確認できる", () => {
    expect(gas().ping()).toMatchObject({ ok: true, backupProtocol: 2 });
  });
});
