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

});
