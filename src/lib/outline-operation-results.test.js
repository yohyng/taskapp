import { beforeEach, describe, expect, it, vi } from "vitest";
const source = vi.hoisted(() => ({ data: [], error: null, requests: [] }));
vi.mock("./supabase", () => ({ isSupabaseEnabled: true, supabase: {
  rpc: async (name, args) => { source.requests.push({ name, args }); return { data: source.data, error: source.error }; },
} }));
import { recoverOutlineOperationResults } from "./db.js";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { source.data = []; source.error = null; source.requests = []; });

describe("旧操作の結果を欠けたまま引き継がない", () => {
  it.each([{ ok: true, revisions: { a: 2 } }, { ok: false, conflicts: [{ id: "a" }] }, { ok: false, retired: true }])("確定結果を操作IDと対応させて返す: %j", async (result) => {
    source.data = [{ operation_id: id, result }];
    expect((await recoverOutlineOperationResults([id, id])).results.get(id)).toEqual(result);
    expect(source.requests).toEqual([{ name: "taskspace_outline_recover_operations", args: { operation_ids: [id] } }]);
  });
  it.each([[], null, [{ operation_id: "別のID", result: { ok: false, retired: true } }],
    [{ operation_id: id, result: {} }], [{ operation_id: id, result: { ok: false, conflicts: [] } }]])("欠落・不正な結果を移行成功にしない: %j", async (data) => {
    source.data = data;
    expect((await recoverOutlineOperationResults([id])).error).toBeTruthy();
  });
  it("SQL未導入と通信失敗を区別する", async () => {
    source.error = { code: "PGRST202", message: "未導入" };
    expect(await recoverOutlineOperationResults([id])).toBeUndefined();
    source.error = { code: "08006", message: "通信に失敗" };
    expect(await recoverOutlineOperationResults([id])).toEqual({ error: "通信に失敗" });
  });
});
