import { beforeEach, describe, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({ rows: [], failAt: null, ranges: [], error: null }));
vi.mock("./supabase", () => ({
  isSupabaseEnabled: true,
  supabase: {
    rpc: () => ({
      order: (key) => {
        expect(key).toBe("node_id");
        return {
          range: async (from, to) => {
            source.ranges.push([from, to]);
            return from === source.failAt
              ? { data: null, error: source.error || { message: "試験用の接続失敗" } }
              : { data: source.rows.slice(from, to + 1), error: null };
          },
        };
      },
    }),
  },
}));

import { loadOutlineRevisions } from "./db.js";

beforeEach(() => {
  source.rows = [];
  source.ranges = [];
  source.failAt = null;
  source.error = null;
});

describe("大きい文書の世代取得", () => {
  it("本文が11432行でも、先頭1000行だけで世代を打ち切らない", async () => {
    source.rows = Array.from({ length: 11432 }, (_, i) => ({ node_id: `行${i}`, revision: i + 1, deleted: i === 11000 }));
    const revisions = await loadOutlineRevisions();
    expect(revisions.size).toBe(11432);
    expect(revisions.get("行11431")).toBe(11432);
    expect(revisions.get("行11000")).toBe(11001);
    expect(source.ranges).toHaveLength(12);
  });
  it("途中ページを読めなければ、不完全な世代一覧を成功として返さない", async () => {
    source.rows = Array.from({ length: 1001 }, (_, i) => ({ node_id: `行${i}`, revision: 1 }));
    source.failAt = 1000;
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect(await loadOutlineRevisions()).toBeNull(); }
    finally { warning.mockRestore(); }
  });
  it("RPC未導入と通信失敗は引き続き区別する", async () => {
    source.failAt = 0;
    source.error = { code: "PGRST202", message: "未導入" };
    expect(await loadOutlineRevisions()).toBeUndefined();
  });
});
