import { afterEach, describe, it, expect, vi } from 'vitest';
import { paintSketch, readSketchDraft } from './sketch';

afterEach(() => vi.unstubAllGlobals());
describe('ペンの線と下書き', () => {
  it('従来の下書きと筆圧付きの下書きを一緒に読み戻せる', () => {
    const old = { color: '#202020', width: 3, points: [[0.1, 0.2], [0.3, 0.4]] };
    const pen = { ...old, pressure: true, points: [[0.1, 0.2, 0.1], [0.3, 0.4, 0.9]] };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([old, pen]) });
    expect(readSketchDraft()).toEqual([old, pen]);
  });
  it('筆圧の値が壊れている線を読み込まない', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([{ color: '#202020', width: 3, pressure: true, points: [[0.1, 0.2, 10]] }]) });
    expect(readSketchDraft()).toEqual([]);
  });
  it('通常の線は同じ太さで、筆圧の線だけ強弱を描き分ける', () => {
    const widths = [], ctx = { fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() { widths.push(this.lineWidth); } };
    const canvas = { width: 600, height: 360, getContext: () => ctx };
    const stroke = { color: '#202020', width: 3, points: [[0.1, 0.2, 0.1], [0.3, 0.4, 0.1], [0.5, 0.6, 0.9], [0.7, 0.8, 0.9]] };
    paintSketch(canvas, [stroke]);
    expect(widths).toEqual([3, 3, 3]);
    widths.length = 0;
    paintSketch(canvas, [{ ...stroke, pressure: true }]);
    expect(widths[0]).toBeLessThan(3);
    expect(widths.at(-1)).toBeGreaterThan(3);
  });
  it('紙を縦に広げても従来の線の位置と大きさを保つ', () => {
    const ends = [], ctx = { fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo(x, y) { ends.push([x, y]); }, stroke() {} };
    const old = { color: '#202020', width: 3, points: [[0.1, 0.2], [0.3, 0.4]] };
    const canvas = { width: 1200, height: 720, getContext: () => ctx };
    paintSketch(canvas, [old]);
    const original = [...ends]; ends.length = 0;
    canvas.height = 1440;
    paintSketch(canvas, [old, { ...old, height: 720, points: [[0.1, 0.7], [0.3, 0.8]] }]);
    expect(ends[0]).toEqual(original[0]);
    expect(ends[1]).toEqual([360, 1152]);
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([{ ...old, height: 720 }, { ...old, height: -1 }]) });
    expect(readSketchDraft()).toEqual([{ ...old, height: 720 }]);
  });

  it('軽い筆圧の線を拾い、筆圧の強弱を広げたまま下書きから戻せる', () => {
    const widths = [], ctx = { fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() { widths.push(this.lineWidth); } };
    const canvas = { width: 600, height: 360, getContext: () => ctx };
    const stroke = { color: '#202020', width: 3, pressure: true, points: [[0.1, 0.2, 0.02], [0.3, 0.4, 0.02], [0.5, 0.6, 0.9], [0.7, 0.8, 0.9]] };
    paintSketch(canvas, [stroke]); const previous = [...widths]; widths.length = 0;
    const light = { ...stroke, pressureStyle: 'light' };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([light]) });
    paintSketch(canvas, readSketchDraft());
    expect(widths[0]).toBeGreaterThan(0);
    expect(widths.at(-1) / widths[0]).toBeGreaterThan(previous.at(-1) / previous[0]);
    expect(widths.at(-1)).toBeGreaterThan(previous.at(-1));
  });

  it('芯のあるペンは軽い力でも細くなりすぎず、普段の筆圧では太さを安定させる', () => {
    const widths = [], ctx = { fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() { widths.push(this.lineWidth); } };
    const canvas = { width: 600, height: 360, getContext: () => ctx };
    const line = (pressure, pressureStyle) => ({ color: '#202020', width: 3, pressure: true, pressureStyle, points: [[0.1, 0.1, pressure], [0.2, 0.2, pressure]] });
    const strokes = [line(0.02, 'core'), line(0.15, 'core'), line(0.5, 'core'), line(0.95, 'core'), line(0.02, 'light')];
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(strokes) });
    paintSketch(canvas, readSketchDraft());
    expect(widths).toHaveLength(5);
    expect(widths[0]).toBeGreaterThan(3);
    expect(widths[0]).toBeGreaterThan(widths[4] * 1.8);
    expect(widths[2] / widths[1]).toBeLessThan(1.03);
    expect(widths[3]).toBeGreaterThan(widths[2]);
    expect(widths[3] / widths[2]).toBeLessThan(1.3);
  });

  it('なめらかな線は線分の両端の太さをつなぎ、丸い端と復元時の設定を保つ', () => {
    const moves = [], lines = [], radii = []; let closed = 0;
    const ctx = { fillRect() {}, beginPath() {}, arc(x, y, radius) { radii.push(radius); }, fill() {}, moveTo(x, y) { moves.push([x, y]); }, lineTo(x, y) { lines.push([x, y]); }, closePath() { closed++; } };
    const canvas = { width: 600, height: 360, getContext: () => ctx };
    const stroke = { color: '#202020', width: 3, pressure: true, pressureStyle: 'flow', points: [[0.1, 0.5, 0.1], [0.9, 0.5, 0.9]] };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([stroke]) });
    paintSketch(canvas, readSketchDraft());
    expect(closed).toBe(1);
    expect(radii).toHaveLength(2);
    expect(radii[1]).toBeGreaterThan(radii[0]);
    expect(moves[0]).toEqual([60, 180 + radii[0]]);
    expect(lines[0]).toEqual([540, 180 + radii[1]]);
    expect(lines[1]).toEqual([540, 180 - radii[1]]);
  });

  it('新しい強弱は軽い線の芯を残して差を広げ、以前の下書きの太さを保つ', () => {
    const radii = [];
    const ctx = { fillRect() {}, beginPath() {}, arc(x, y, r) { radii.push(r); }, fill() {} };
    const canvas = { width: 600, height: 360, getContext: () => ctx };
    const line = (p, version) => ({ color: '#202020', width: 3, pressure: true, pressureStyle: 'flow', pressureVersion: version, points: [[0.1, 0.1, p]] });
    paintSketch(canvas, [line(0.02), line(0.9), line(0.02, 2), line(0.9, 2)]);
    expect(radii[2]).toBeGreaterThan(1.4);
    expect(radii[3] / radii[2]).toBeGreaterThan(2);
    expect(radii[3] / radii[2]).toBeGreaterThan(radii[1] / radii[0]);
  });

});
