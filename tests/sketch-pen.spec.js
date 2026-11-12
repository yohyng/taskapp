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

test('手が先に触れてもペンだけを保存し、長押し選択を手書き欄で止める', async ({page}) => {
  await page.locator('[data-quick-add]').click(); await page.locator('[data-quick-add-sketch]').click();
  const result = await page.locator('[data-sketch-canvas]').evaluate(canvas => {
    canvas.setPointerCapture=()=>{}; canvas.hasPointerCapture=()=>false;
    const r=canvas.getBoundingClientRect();
    const emit=(type,pointerType,pointerId,x)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,isPrimary:true,pointerType,pointerId,button:0,clientX:r.left+r.width*x,clientY:r.top+r.height*.4}));
    emit('pointerdown','touch',1,.1); emit('pointermove','touch',1,.2);
    emit('pointerdown','pen',2,.3); emit('pointermove','pen',2,.8);
    emit('pointerup','touch',1,.2); emit('pointerup','pen',2,.8);
    return {selectAllowed:canvas.dispatchEvent(new Event('selectstart',{bubbles:true,cancelable:true})), calloutAllowed:canvas.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})), selection:getComputedStyle(canvas).userSelect};
  });
  expect(result).toEqual({selectAllowed:false,calloutAllowed:false,selection:'none'});
  await expect(page.locator('[data-sketch-pen-only]')).toBeChecked();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('taskspace-quick-sketch-v1')));
  expect(saved).toHaveLength(1); expect(saved[0].points[0]).toEqual([.3,.4]);
});

test('紙の四辺を広げても線を伸ばさず、左右の余白と位置を復元できる', async ({page}) => {
  await page.locator('[data-quick-add]').click(); await page.locator('[data-quick-add-sketch]').click();
  const canvas=page.locator('[data-sketch-canvas]'); await canvas.scrollIntoViewIfNeeded();
  const box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*.2,box.y+box.height*.3); await page.mouse.down();
  await page.mouse.move(box.x+box.width*.6,box.y+box.height*.6,{steps:8}); await page.mouse.up();
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('taskspace-quick-sketch-v1'))[0]);
  for (const [edge,key] of [['left','ArrowLeft'],['top','ArrowUp'],['right','ArrowRight'],['bottom','ArrowDown']]) {
    await page.locator(`[data-sketch-edge="${edge}"]`).focus(); await page.keyboard.press(key);
  }
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('taskspace-quick-sketch-v1'))[0]);
  expect(after.paperWidth).toBe(660); expect(after.height).toBe(420);
  expect(after.points[0][0]*660).toBeCloseTo(before.points[0][0]*600+30);
  expect(after.points[0][1]*420).toBeCloseTo(before.points[0][1]*360+30);
  expect(after.width).toBe(before.width); expect(after.times).toEqual(before.times);
  const size=await canvas.boundingBox();
  expect(size.width/660).toBeCloseTo(box.width/600,2);
  await page.reload(); await page.locator('[data-quick-add]').click();
  await expect(canvas).toHaveAttribute('width','1320'); await expect(canvas).toHaveAttribute('height','840');
});

test('紙の右端をドラッグで足した余白にも、すぐ線を書ける', async ({page}) => {
  await page.locator('[data-quick-add]').click(); await page.locator('[data-quick-add-sketch]').click();
  const grip=page.locator('[data-sketch-edge="right"]'); await grip.scrollIntoViewIfNeeded();
  const r=await grip.boundingBox();
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2); await page.mouse.down();
  await page.mouse.move(r.x+r.width/2+60,r.y+r.height/2,{steps:8}); await page.mouse.up();
  const canvas=page.locator('[data-sketch-canvas]');
  expect(Number(await canvas.getAttribute('width'))).toBeGreaterThan(1200);
  await page.locator('[data-sketch-viewport]').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  const box=await canvas.boundingBox(), x=box.x+box.width-20,y=box.y+30;
  await page.mouse.move(x-20,y); await page.mouse.down(); await page.mouse.move(x,y+30,{steps:5});
  expect(await canvas.evaluate(el=>{
    const p=el.getContext('2d').getImageData(el.width-160,0,160,160).data;
    return p.some((v,i)=>i%4<3&&v<100);
  })).toBe(true);
  await page.mouse.up();
  await expect(page.locator('[data-sketch-undo]')).toBeEnabled();
});

test('紙の移動モードではドラッグを線として保存せず、ペン専用でも紙を移動できる', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-quick-add]').click(); await page.locator('[data-quick-add-sketch]').click();
  await page.locator('[data-sketch-edge="right"]').focus();
  for(let i=0;i<10;i++) await page.keyboard.press('ArrowRight');
  await page.locator('[data-sketch-pen-only]').check(); await page.locator('[data-sketch-pan]').click();
  const canvas=page.locator('[data-sketch-canvas]'); await canvas.scrollIntoViewIfNeeded();
  await page.locator('[data-sketch-viewport]').evaluate(el=>{el.scrollLeft=0;});
  const r=await canvas.boundingBox();
  await page.mouse.move(r.x+180,r.y+50); await page.mouse.down();
  await page.mouse.move(r.x+60,r.y+50,{steps:8}); await page.mouse.up();
  expect(await page.locator('[data-sketch-viewport]').evaluate(el=>el.scrollLeft)).toBeGreaterThan(80);
  await expect(page.locator('[data-sketch-undo]')).toBeDisabled();
  await page.locator('[data-sketch-pan]').click();
  await expect(page.locator('[data-sketch-pan]')).toHaveAttribute('aria-pressed','false');
});

test('紙と一緒にnoteの外枠も広がり、線の表示倍率は変わらない', async ({page}, testInfo) => {
  await page.setViewportSize({width:1600,height:1200});
  await page.locator('[data-quick-add]').click(); await page.locator('[data-quick-add-sketch]').click();
  const board=page.locator('[data-note-board]'),canvas=page.locator('[data-sketch-canvas]');
  const before=await board.boundingBox(), paperBefore=await canvas.boundingBox();
  await page.locator('[data-sketch-edge="right"]').focus();
  for(let i=0;i<10;i++) await page.keyboard.press('ArrowRight');
  const after=await board.boundingBox(),paperAfter=await canvas.boundingBox();
  expect(after.width).toBeGreaterThan(before.width+100);
  expect(paperAfter.width/900).toBeCloseTo(paperBefore.width/600,2);
  expect(paperAfter.height).toBeCloseTo(paperBefore.height,0);
  await page.locator('[data-quick-add-sketch]').click(); await page.locator('[data-quick-add-sketch]').click();
  expect((await board.boundingBox()).width).toBeCloseTo(after.width,0);
  expect((await canvas.boundingBox()).width).toBeCloseTo(paperAfter.width,0);
  await page.locator('[data-sketch-edge="bottom"]').focus(); await page.keyboard.press('ArrowDown');
  expect((await board.boundingBox()).height).toBeGreaterThan(after.height);
  await page.screenshot({path:`test-results/note-wide-${testInfo.project.name}.png`});
  await page.setViewportSize({width:390,height:844});
  const mobile=await board.boundingBox(); expect(mobile.x).toBeGreaterThanOrEqual(0);
  expect(mobile.x+mobile.width).toBeLessThanOrEqual(390);
});
