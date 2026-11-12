import { afterEach, describe, it, expect, vi } from 'vitest';
import { paintSketch, readSketchDraft, sketchPreviewStroke, expandSketchPaper, fitSketchToPaper } from './sketch';

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

});

it('速度ペンの下書きは時刻付きで復元し、壊れた時刻や未知のペンを除外する',()=>{
  const stroke={color:'#202020',width:10,height:360,brush:'speed-extreme-v1',times:[0,16],points:[[.1,.2],[.3,.4]]};
  vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify([null,stroke,{...stroke,times:[0]},{...stroke,times:[16,0]},{...stroke,brush:'unknown'}])});
  expect(readSketchDraft()).toEqual([stroke]);
});

it('長い線のプレビュー計算を制限し、先端と保存用の全入力を保つ',()=>{
  const points=Array.from({length:10000},(_,i)=>[i/10000,.4]), times=points.map((_,i)=>i*4);
  const stroke={brush:'speed-extreme-v1',points,times,color:'#202020',width:10};
  const view=sketchPreviewStroke(stroke);
  expect(view.points).toHaveLength(512); expect(view.times).toHaveLength(512);
  expect(view.points.slice(-128)).toEqual(points.slice(-128));
  expect(view.times.at(-1)).toBe(times.at(-1));
  expect(stroke.points).toBe(points); expect(stroke.points).toHaveLength(10000);
  expect(sketchPreviewStroke({...stroke,points:points.slice(0,100),times:times.slice(0,100)}).points).toHaveLength(100);
});

it('四辺へ余白を足しても線の実寸・筆圧・時刻を保つ', () => {
  const stroke = { color: '#202020', width: 10, brush: 'speed-extreme-v1', times: [0, 16], points: [[.2, .3, .1], [.8, .7, .9]] };
  let paper = { width: 600, height: 360 }, strokes = [stroke];
  for (const edge of ['left', 'top', 'right', 'bottom']) {
    const before = strokes[0], next = expandSketchPaper(paper, edge, 80);
    strokes = fitSketchToPaper(strokes, next);
    expect(strokes[0].points[0][0] * next.width).toBeCloseTo(before.points[0][0] * (before.paperWidth || 600) + next.shiftX);
    expect(strokes[0].points[0][1] * next.height).toBeCloseTo(before.points[0][1] * (before.height || 360) + next.shiftY);
    expect(strokes[0].points.map(p => p[2])).toEqual([.1, .9]);
    expect(strokes[0].times).toEqual([0, 16]); expect(strokes[0].width).toBe(10);
    paper = { width: next.width, height: next.height };
  }
  expect(stroke.points).toEqual([[.2, .3, .1], [.8, .7, .9]]);
  vi.stubGlobal('localStorage', {getItem: () => JSON.stringify(strokes)});
  expect(readSketchDraft()).toEqual(strokes);
  expect(expandSketchPaper({width:1190,height:360},'right',100).width).toBe(1200);
});
it('横に広げた紙でも古い線を拡大せず、新しい紙の座標で描く', () => {
  const ends = [], ctx = { fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo(x,y) {ends.push([x,y]);}, stroke() {} };
  const canvas = {width:1600,height:720,getContext:()=>ctx};
  const old = {color:'#202020',width:3,points:[[.1,.2],[.3,.4]]};
  paintSketch(canvas,[old],800);
  expect(ends[0]).toEqual([360,288]);
  ends.length=0;
  const paper=expandSketchPaper({width:600,height:360},'left',200);
  paintSketch(canvas,fitSketchToPaper([old],paper),800);
  expect(ends[0]).toEqual([760,288]);
});
