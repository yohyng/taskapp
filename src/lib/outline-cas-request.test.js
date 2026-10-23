import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => []);
vi.mock("./supabase", () => ({
  isSupabaseEnabled: true,
  supabase: { rpc: async (name, request) => {
    requests.push(structuredClone({ name, request }));
    return { data: { ok: true, revisions: { a: 2 } }, error: null };
  } },
}));

import { outlineCasChanges, saveOutlineRowsCas, noteAbsentOutlineColumns } from "./db.js";

beforeEach(() => { requests.length = 0; noteAbsentOutlineColumns([{ date: null }]); });

describe("再送要求は通信時の姿を保つ", () => {
  it("再起動で任意列の有無や本文・配置・世代が変わっても、確定済み要求をそのまま送る", async () => {
    const rows = [{ id: "a", text: "送った本文", parentId: "parent", sortOrder: 100, imageWidth: 300 }];
    const expected = new Map([["a", 1], ["b", 4]]);
    const frozen = JSON.parse(JSON.stringify(outlineCasChanges(rows, ["b"], expected)));
    expect(frozen[0].row).toMatchObject({ parent_id: "parent", sort_order: 100 });
    expect(frozen[0].row).not.toHaveProperty("image_width");
    await saveOutlineRowsCas(rows, ["b"], "same-id", expected, frozen);
    noteAbsentOutlineColumns([{ date: null, image_width: null, heading_level: null, text_color: null, bg_color: null }]);
    const newer = [{ ...rows[0], text: "書き続けた本文", parentId: null, sortOrder: 0 }];
    await saveOutlineRowsCas(newer, [], "same-id", new Map([["a", 2]]), frozen);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[1].request.changes[1]).toEqual({ id: "b", kind: "delete", expected_revision: 4 });
  });
});
