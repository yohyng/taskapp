import { describe, expect, it } from 'vitest';
import { inkOutline, inkPoints, readInkDraft, INK_ORGANIC, INK_LOCAL_RETURN, INK_CURVE_RETURN } from './ink-comparison';

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

  it('細くなる側と太くなる側の反応を独立させ、旧設定の線幅を保つ', () => {
    const input = samples(1);
    const legacy = inkPoints(input, 'speed', { response: 28 });
    expect(inkPoints(input, 'speed', { responseThin: 28, responseThick: 28 })).toEqual(legacy);
    expect(inkPoints(input, 'speed', { responseThin: 4, responseThick: 64 })[1][2]).toBeLessThan(legacy[1][2]);
    const stopped = [...input, { ...input.at(-1), t: input.at(-1).t + 16 }];
    const quick = inkPoints(stopped, 'speed', { responseThin: 16, responseThick: 4 }).at(-1)[2];
    const gentle = inkPoints(stopped, 'speed', { responseThin: 16, responseThick: 64 }).at(-1)[2];
    expect(quick).toBeGreaterThan(gentle);
  });

});

it('ゆらぎ設定は実測軌跡を保ち、速い区間の厚みを残し、下書きを同じ輪郭へ復元する', () => {
  const input = samples(2), stroke = { mode: 'speed', width: 10, settings: INK_ORGANIC, samples: input };
  const points = inkPoints(input, 'speed', INK_ORGANIC);
  expect(points.map(p => p.slice(0, 2))).toEqual(input.map(p => [p.x, p.y]));
  expect(points.at(-1)[2]).toBeGreaterThan(inkPoints(input, 'speed').at(-1)[2]);
  expect(inkOutline(readInkDraft(JSON.stringify([stroke]))[0])).toEqual(inkOutline(stroke));
});

it('局所的なたまりは等速時に増えず、減速時だけ厚みを残し復元できる', () => {
  const fast = samples(2), config = INK_LOCAL_RETURN;
  const base = { ...config, localReturn: 0 };
  expect(inkPoints(fast, 'speed', config).at(-1)[2]).toBeCloseTo(inkPoints(fast, 'speed', base).at(-1)[2], 8);
  const last = fast.at(-1), input = [...fast, { ...last, x: last.x + 1, t: last.t + 16 }];
  expect(inkPoints(input, 'speed', config).at(-1)[2]).toBeGreaterThan(inkPoints(input, 'speed', base).at(-1)[2]);
  const stroke = { mode: 'speed', width: 10, samples: input, settings: config };
  expect(inkOutline(readInkDraft(JSON.stringify([stroke]))[0])).toEqual(inkOutline(stroke));
});

it('曲がりの厚みは直線へ足さず、角の座標と復元を維持する', () => {
  const input = [...samples(1), { x: 180, y: 108, t: 168, p: 0.4 }, { x: 180, y: 116, t: 176, p: 0.4 }];
  const config = { ...INK_CURVE_RETURN, widthResponse: 0 };
  const withCurve = inkPoints(input, 'speed', config), plain = inkPoints(input, 'speed', { ...config, curveReturn: 0 });
  expect(withCurve.slice(0, -2)).toEqual(plain.slice(0, -2));
  expect(withCurve.at(-1)[2]).toBeGreaterThan(plain.at(-1)[2]);
  expect(withCurve.map(p=>p.slice(0,2))).toEqual(input.map(p=>[p.x,p.y]));
  const stroke = { mode: 'speed', width: 10, samples: input, settings: INK_CURVE_RETURN };
  expect(inkOutline(readInkDraft(JSON.stringify([stroke]))[0])).toEqual(inkOutline(stroke));
});
