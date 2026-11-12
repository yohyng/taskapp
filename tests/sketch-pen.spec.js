import { test, expect } from './helpers.js';

test('ペン専用：指の線を入れず筆圧付きのペンを保存し、再起動しても復元する', async ({ page }) => {
  await page.locator('[data-quick-add]').click();
  await page.locator('[data-quick-add-sketch]').click();
  await page.locator('[data-sketch-brush]').selectOption('legacy');
  await expect(page.locator('[data-sketch-pressure]')).not.toBeChecked();
  await page.locator('[data-sketch-pen-only]').check();
  await page.locator('[data-sketch-pressure]').check();
  await page.locator('[data-sketch-canvas]').evaluate((canvas) => {
    // 合成ペンにはOSのポインターが無い。実ポインターの捕捉は通常描画の試験で確認する。
    canvas.setPointerCapture = () => {};
    canvas.hasPointerCapture = () => false;
    const rect = canvas.getBoundingClientRect();
    for (const pointerType of ['touch', 'mouse', 'pen']) {
      const dispatch = (type, x, pressure) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 8, pointerType, button: 0, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height / 2, pressure }));
      dispatch('pointerdown', 0.2, 0.1);
      dispatch('pointermove', 0.8, 0.9);
      dispatch('pointerup', 0.8, 0);
    }
  });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('taskspace-quick-sketch-v1')));
  expect(saved).toHaveLength(1);
  expect(saved[0].pressure).toBe(true);
  expect(saved[0].points[0][2]).toBeCloseTo(0.1, 5);
  expect(saved[0].points[1][2]).toBeCloseTo(0.9, 5);
  await page.reload();
  await page.locator('[data-quick-add]').click();
  await expect(page.locator('[data-sketch-pen-only]')).toBeChecked();
  await expect(page.locator('[data-sketch-pressure]')).toBeChecked();
  await expect(page.locator('[data-sketch-undo]')).toBeEnabled();
});

test('ペンの追従：まとめて届く途中の座標を拾い、移動中に過去の線を描き直さない', async ({ page }) => {
  await page.locator('[data-quick-add]').click();
  await page.locator('[data-quick-add-sketch]').click();
  const canvas = page.locator('[data-sketch-canvas]');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 15, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 15, box.y + 50, { steps: 12 });
  await page.mouse.up();
  const counts = await canvas.evaluate((el) => {
    const ctx = el.getContext('2d'), originalFill = ctx.fillRect.bind(ctx), originalLine = ctx.lineTo.bind(ctx);
    const counters = { clears: 0, segments: 0 };
    ctx.fillRect = (...args) => { counters.clears++; originalFill(...args); };
    ctx.lineTo = (...args) => { counters.segments++; originalLine(...args); };
    el.setPointerCapture = () => {};
    el.hasPointerCapture = () => false;
    const rect = el.getBoundingClientRect();
    const event = (type, x, y) => new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 9, pointerType: 'pen', button: 0, clientX: rect.left + rect.width * x, clientY: rect.top + rect.height * y, pressure: 0.5 });
    el.dispatchEvent(event('pointerdown', 0.2, 0.3));
    const move = event('pointermove', 0.8, 0.6);
    move.getCoalescedEvents = () => [event('pointermove', 0.4, 0.2), event('pointermove', 0.6, 0.7)];
    el.dispatchEvent(move);
    const duringMove = { ...counters };
    el.dispatchEvent(event('pointerup', 0.8, 0.6));
    return duringMove;
  });
  expect(counts.clears).toBe(0);
  expect(counts.segments).toBeLessThanOrEqual(4);
  const points = await page.evaluate(() => JSON.parse(localStorage.getItem('taskspace-quick-sketch-v1')).at(-1).points);
  expect(points).toEqual([[0.2, 0.3], [0.4, 0.2], [0.6, 0.7], [0.8, 0.6]]);
});

test('本番の速度ペンは時刻と種類を保存し、復元した絵とPNGの形を保つ', async ({ page }) => {
  await page.locator('[data-quick-add]').click(); await page.locator('[data-quick-add-sketch]').click();
  await expect(page.locator('[data-sketch-brush]')).toHaveValue('speed-extreme-v1');
  const canvas = page.locator('[data-sketch-canvas]'); await canvas.scrollIntoViewIfNeeded(); const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x+20, rect.y+20); await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*.7, rect.y+rect.height*.6, { steps: 20 }); await page.mouse.up();
  const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('taskspace-quick-sketch-v1')));
  expect(saved[0].brush).toBe('speed-extreme-v1'); expect(saved[0].times.length).toBe(saved[0].points.length);
  expect(saved[0].times.at(-1)).toBeGreaterThan(0);
  const before = await canvas.evaluate(c=>c.toDataURL());
  await page.reload(); await page.locator('[data-quick-add]').click();
  expect(await page.locator('[data-sketch-canvas]').evaluate(c=>c.toDataURL())).toBe(before);

});

test('一画の途中でレイアウトを測り直さず最初の移動を即時に描く', async ({ page }) => {
  await page.locator('[data-quick-add]').click(); await page.locator('[data-quick-add-sketch]').click();
  const result = await page.locator('[data-sketch-canvas]').evaluate(canvas=>{
    const rect=canvas.getBoundingClientRect(), original=canvas.getBoundingClientRect.bind(canvas);let reads=0;
    canvas.getBoundingClientRect=()=>{reads++;return original();}; canvas.setPointerCapture=()=>{};canvas.hasPointerCapture=()=>false;
    const send=(type,x)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,isPrimary:true,pointerId:42,pointerType:'pen',button:0,clientX:rect.left+rect.width*x,clientY:rect.top+40,pressure:.5}));
    send('pointerdown',.1); send('pointermove',.4);
    const pixels=canvas.getContext('2d').getImageData(Math.round(canvas.width*.3),Math.round(40/rect.height*canvas.height)-2,4,4).data;
    const drawn=pixels.some((v,i)=>i%4===0&&v<100);
    for(let i=0;i<100;i++)send('pointermove',.4+i*.003);
    send('pointerup',.7); return {reads,drawn};
  });
  expect(result.reads).toBe(1); expect(result.drawn).toBe(true);
});

test('ペンを離す前に表示用の紙へ線が出て、保存は確定後だけ行う', async ({ page }) => {
  await page.locator('[data-quick-add]').click(); await page.locator('[data-quick-add-sketch]').click();
  await expect(page.locator('[data-sketch-overlay]')).toHaveCount(0);
  const canvas=page.locator('[data-sketch-canvas]'); await canvas.scrollIntoViewIfNeeded();const rect=await canvas.boundingBox();
  await page.mouse.move(rect.x+rect.width*.1,rect.y+rect.height*.4);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*.8,rect.y+rect.height*.4,{steps:30});
  expect(await page.evaluate(()=>localStorage.getItem('taskspace-quick-sketch-v1'))).toBeNull();
  await expect.poll(()=>canvas.evaluate(c=>{const y=Math.round(c.height*.4);const data=c.getContext('2d').getImageData(Math.round(c.width*.6),y-3,6,6).data;return data.some((v,i)=>i%4===0&&v<100);})).toBe(true);
  await page.screenshot({path:`test-results/live-before-up-${test.info().project.name}.png`});
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('taskspace-quick-sketch-v1')||'[]').length)).toBe(1);
});
