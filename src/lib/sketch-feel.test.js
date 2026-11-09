import { describe, it, expect } from "vitest";
import { createSketchFilter, filterSketchPoint } from "./sketch-feel";

describe("少し粘るペン", () => {
  it("小さな揺れを抑え、筆圧は元の値を保つ", () => {
    const state = createSketchFilter([0.5, 0.5, 0.4], 0, 600, 360);
    let input = 0, output = 0;
    for (let i = 1; i <= 30; i++) {
      const raw = [0.5 + i / 3000, 0.5 + (i % 2 ? 0.002 : -0.002), 0.7];
      const next = filterSketchPoint(state, raw, i * 8);
      input += Math.abs(raw[1] - 0.5); output += Math.abs(next[1] - 0.5);
      expect(next[2]).toBe(0.7);
    }
    expect(output).toBeLessThan(input * 0.7);
  });
  it("速い線や折り返しも表示上3px以内で追い、時間が重複しても壊れない", () => {
    const state = createSketchFilter([0.1, 0.1], 0, 300, 600);
    for (const [point, time] of [[[0.9, 0.9], 8], [[0.1, 0.1], 8], [[0.8, 0.2], 16]]) {
      const next = filterSketchPoint(state, point, time);
      expect(Math.hypot((point[0] - next[0]) * 300, (point[1] - next[1]) * 600)).toBeLessThanOrEqual(3.00001);
      expect(next.every(Number.isFinite)).toBe(true);
    }
  });
  it("軽やかなペンは弱い補正より速く追い、ペン先から1px以内に収まる", () => {
    const raw = [0.505, 0.502];
    const soft = filterSketchPoint(createSketchFilter([0.5, 0.5], 0, 600, 360), raw, 8);
    const light = filterSketchPoint(createSketchFilter([0.5, 0.5], 0, 600, 360, "light"), raw, 8);
    const gap = (point) => Math.hypot((raw[0] - point[0]) * 600, (raw[1] - point[1]) * 360);
    expect(gap(light)).toBeLessThan(gap(soft));
    expect(gap(light)).toBeLessThanOrEqual(1.00001);
  });

  it("太さの急変だけをならし、芯のあるペンの座標追従を保つ", () => {
    const flow = createSketchFilter([0.1, 0.1, 0.1], 0, 600, 360, "flow");
    const core = createSketchFilter([0.1, 0.1, 0.1], 0, 600, 360, "core");
    const a = filterSketchPoint(flow, [0.2, 0.15, 0.9], 8);
    const b = filterSketchPoint(core, [0.2, 0.15, 0.9], 8);
    expect(a.slice(0, 2)).toEqual(b.slice(0, 2));
    expect(a[2]).toBeGreaterThan(0.1); expect(a[2]).toBeLessThan(0.9);
    const next = filterSketchPoint(flow, [0.3, 0.2, 0.9], 16);
    expect(next[2]).toBeGreaterThan(a[2]); expect(next[2]).toBeLessThan(0.9);
  });

  it("細かな筆圧の変化を残し、座標の追従と筆圧の範囲を保つ", () => {
    const detail = createSketchFilter([0.1, 0.1, 0.3], 0, 600, 360, "flow", true);
    const old = createSketchFilter([0.1, 0.1, 0.3], 0, 600, 360, "flow");
    let fineChange = 0, oldChange = 0;
    for (let i = 1; i <= 20; i++) {
      const raw = [0.1 + i * 0.001, 0.1, i % 2 ? 0.35 : 0.25];
      const a = filterSketchPoint(detail, raw, i * 4), b = filterSketchPoint(old, raw, i * 4);
      expect(a.slice(0, 2)).toEqual(b.slice(0, 2));
      expect(a[2]).toBeGreaterThanOrEqual(0.25); expect(a[2]).toBeLessThanOrEqual(0.35);
      fineChange += Math.abs(a[2] - 0.3); oldChange += Math.abs(b[2] - 0.3);
    }
    expect(fineChange).toBeGreaterThan(oldChange * 2);
  });

});
