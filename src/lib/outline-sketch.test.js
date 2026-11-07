import { describe, it, expect } from "vitest";
import { addMemoUnderDate } from "./outline";

describe("手書きのメモ", () => {
  it("従来の空行を画像のないnullへ変えない", () => {
    expect(addMemoUnderDate([], "2026-11-07", "").nodes[0].children[0].text).toBe("");
  });
  it("文字と画像をひとつのメモにまとめ、元の木を変えない", () => {
    const source = [{ id: "today", text: "2026-11-07", children: [{ id: "old", text: "先のメモ", children: [] }] }];
    const result = addMemoUnderDate(source, "2026-11-07", "図の説明", "https://example.test/sketch.png");
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].children).toHaveLength(2);
    expect(result.nodes[0].children[1].text).toBe("図の説明");
    expect(result.nodes[0].children[1].children[0].text).toBe("https://example.test/sketch.png");
    expect(source[0].children).toHaveLength(1);
  });
  it("絵だけなら画像の行をそのまま作る", () => {
    const result = addMemoUnderDate([], "2026-11-07", "", "https://example.test/sketch.png");
    expect(result.nodes[0].children[0].text).toBe("https://example.test/sketch.png");
    expect(result.nodes[0].children[0].children).toEqual([]);
  });
});
