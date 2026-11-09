import { describe, expect, it } from 'vitest';
import { inkOutline, inkPoints, readInkDraft } from './ink-comparison';

const samples = (speed, interval = 8) => Array.from({ length: Math.floor(160 / interval) + 1 }, (_, i) => ({ x: 20 + speed * i * interval, y: 100, t: i * interval, p: 0.4 }));
describe('連続輪郭の比較ペン', () => {
  it('速度型は遅いほど太くなり、入力頻度が違っても同じ速度なら同じ強弱になる', () => {
    expect(inkPoints(samples(0.1), 'speed').at(-1)[2]).toBeGreaterThan(inkPoints(samples(1), 'speed').at(-1)[2]);
    expect(inkPoints(samples(1, 4), 'speed').at(-1)[2]).toBeCloseTo(inkPoints(samples(1, 16), 'speed').at(-1)[2], 8);
  });
  it('実筆圧型は入力を保ち、一定幅は筆圧によって輪郭を変えない', () => {
    const low = samples(1).map((s) => ({ ...s, p: 0.1 })), high = low.map((s) => ({ ...s, p: 0.9 }));
    expect(inkPoints(low, 'pressure').every((p) => p[2] === 0.1)).toBe(true);
    expect(inkOutline({ mode: 'fixed', width: 10, samples: low })).toEqual(inkOutline({ mode: 'fixed', width: 10, samples: high }));
    expect(inkOutline({ mode: 'pressure', width: 10, samples: low })).not.toEqual(inkOutline({ mode: 'pressure', width: 10, samples: high }));
  });
  it('同じ時刻や単独の点でも有限の輪郭を作り、入力を書き換えない', () => {
    const input = [{ x: 40, y: 50, t: 1, p: 0.3 }, { x: 42, y: 55, t: 1, p: 0.8 }], original = structuredClone(input);
    for (const points of [input, input.slice(0, 1)]) expect(inkOutline({ mode: 'speed', width: 10, samples: points }).flat().every(Number.isFinite)).toBe(true);
    expect(input).toEqual(original);
  });
  it('壊れた下書きを除外し、実測値と方式をそのまま復元する', () => {
    const valid = { mode: 'speed', width: 10, samples: samples(1) };
    expect(readInkDraft(JSON.stringify([valid, { ...valid, mode: 'other' }, { ...valid, samples: [{ x: -1, y: 0, t: 0, p: 0.5 }] }]))).toEqual([valid]);
    expect(readInkDraft('broken')).toEqual([]);
  });
  it('未調整の線は同じ形を保ち、強弱ゼロなら筆圧で幅を変えない', () => {
    const stroke = { mode: 'pressure', width: 10, samples: samples(1) };
    expect(inkOutline(stroke)).toEqual(inkOutline({ ...stroke, settings: { thinning: 0.6, response: 16, streamline: 0.15 } }));
    const low = { ...stroke, settings: { thinning: 0 }, samples: stroke.samples.map((s) => ({ ...s, p: 0.1 })) };
    const high = { ...low, samples: low.samples.map((s) => ({ ...s, p: 0.9 })) };
    expect(inkOutline(low)).toEqual(inkOutline(high));
    const fast = inkPoints(samples(1), 'speed', { response: 4 });
    const slow = inkPoints(samples(1), 'speed', { response: 64 });
    expect(fast[1][2]).toBeLessThan(slow[1][2]);
  });

});
