import { test, expect } from './helpers.js';
import { Buffer } from 'node:buffer';

// ヘッダーの sketch は、手書きだけのページへ移る（アプリ本体を載せない）
async function openSketch(page) {
  await page.locator('[data-header-sketch]').click();
  await page.waitForURL(/sketch\.html$/);
  await expect(page.locator('[data-sketch-board]')).toBeVisible();
}

async function back(page) {
  await page.waitForURL((url) => !/sketch\.html$/.test(url.pathname));
  await page.waitForSelector('header');
}

async function draw(page) {
  const canvas=page.locator('[data-sketch-canvas]'); await canvas.scrollIntoViewIfNeeded();
  const r=await canvas.boundingBox();
  await page.mouse.move(r.x+r.width*.2,r.y+50); await page.mouse.down();
  await page.mouse.move(r.x+r.width*.7,r.y+120,{steps:12}); await page.mouse.up();
}

test('ヘッダーのsketchから紙を直接開き、文字入力や日付を出さず下書きを復元する', async ({page}, testInfo) => {
  await openSketch(page);
  await expect(page.locator('[data-sketch-dialog] textarea')).toHaveCount(0);
  await expect(page.locator('[data-add-task]')).toHaveCount(0);
  await expect(page.locator('[data-sketch-save]')).toBeDisabled();
  await expect(page.locator('[data-sketch-settings]')).toHaveAttribute('aria-expanded','false');
  await expect(page.locator('[data-sketch-brush]')).toBeHidden();
  expect(await page.evaluate(()=>document.activeElement.tagName)).toBe('BUTTON');
  await draw(page);
  await expect(page.locator('[data-sketch-save]')).toBeEnabled();
  await page.screenshot({path:`test-results/sketch-board-${testInfo.project.name}.png`});
  await page.keyboard.press('Escape'); await back(page);
  await openSketch(page); await expect(page.locator('[data-sketch-undo]')).toBeEnabled();
  await page.locator('[data-sketch-settings]').click(); await expect(page.locator('[data-sketch-brush]')).toBeVisible();
  await page.locator('[data-sketch-close]').click(); await back(page); await page.locator('[data-quick-add]').click();
  await expect(page.locator('[data-note-board] textarea')).toBeVisible();
  await expect(page.locator('[data-sketch-canvas]')).toHaveCount(0);
  await page.locator('[data-note-board] textarea').fill('文字だけのタスク');
  await expect(page.locator('[data-add-task]')).toBeEnabled();
  await page.locator('[data-add-task]').click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('taskspace-quick-sketch-v1')).length)).toBe(1);
});

test('sketchの保存に失敗しても紙を残し、再試行で画像メモを一件だけ追加する', async ({page}) => {
  await page.evaluate(()=>localStorage.setItem('taskspace-drive-url','https://sketch.invalid/upload'));
  let fail=true;
  await page.route('https://sketch.invalid/upload', async route=>{
    const image=Buffer.from(route.request().postDataJSON().dataBase64,'base64');
    expect([...image.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
    await route.fulfill({status:fail?503:200,json:fail?{}:{url:'https://sketch.invalid/board.png'}});
  });
  await openSketch(page); await draw(page);
  await page.locator('[data-sketch-save]').click(); await expect(page.locator('[data-sketch-status]')).toContainText('下書きに残っています');
  fail=false; await page.locator('[data-sketch-save]').click();
  await expect(page.locator('[data-sketch-save]')).toBeDisabled();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('taskspace-quick-sketch-v1'))).toBeNull();
  // 手書きのページは木を持たない。置き場へ上げたら追加待ちに積み、アプリで木へ入る。
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('taskspace-memo-queue-v1') || '[]').length)).toBe(1);
  await page.locator('[data-sketch-close]').click(); await back(page);
  await expect.poll(()=>page.evaluate(()=>(localStorage.getItem('taskspace-outline-v1') || '').split('https://sketch.invalid/board.png').length-1)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('taskspace-memo-queue-v1'))).toBeNull();
});

test('スマホのsketchは画面に収まり、大きな紙をすぐ描ける', async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await openSketch(page);
  const box=await page.locator('[data-sketch-board]').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(390);
  expect(box.y+box.height).toBeLessThanOrEqual(844);
  const paper=await page.locator('[data-sketch-canvas]').boundingBox(); expect(paper.height).toBeGreaterThan(300);
  await draw(page); await expect(page.locator('[data-sketch-save]')).toBeEnabled();
});

test('sketchは画面幅いっぱいに開き、紙を横へ広げず縦だけスクロールする', async ({page}, testInfo) => {
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>localStorage.setItem('taskspace-sketch-paper-v1',JSON.stringify({width:1200,height:1200})));
  await openSketch(page);
  const board=page.locator('[data-sketch-board]'), viewport=page.locator('[data-sketch-viewport]');
  expect((await board.boundingBox()).width).toBeCloseTo(1280,0);
  await expect(page.locator('[data-sketch-edge="left"]')).toHaveCount(0);
  await expect(page.locator('[data-sketch-edge="right"]')).toHaveCount(0);
  const metrics=()=>viewport.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,height:el.clientHeight,scrollHeight:el.scrollHeight}));
  await expect.poll(async()=>{const m=await metrics(); return m.scrollWidth-m.width;}).toBeLessThanOrEqual(1);
  expect((await metrics()).scrollHeight).toBeGreaterThan((await metrics()).height);
  const canvas=page.locator('[data-sketch-canvas]'); const width=await canvas.getAttribute('width');
  await viewport.evaluate(el=>{el.scrollTop=200;});
  expect(await viewport.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({path:`test-results/sketch-full-width-${testInfo.project.name}.png`});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(async()=>{const m=await metrics();return m.scrollWidth-m.width;}).toBeLessThanOrEqual(1);
  expect((await board.boundingBox()).width).toBeCloseTo(390,0);
  await expect(canvas).toHaveAttribute('width',width);
});

test('一画の確定では過去の線を塗り直さず、描き終えた紙をそのまま使う', async ({page}) => {
  await page.evaluate(()=>{
    const stroke={color:'#202020',width:10,height:360,paperWidth:600,brush:'speed-extreme-v1',times:[0,16],points:[[.1,.2],[.8,.5]]};
    localStorage.setItem('taskspace-quick-sketch-v1',JSON.stringify(Array.from({length:200},()=>stroke)));
  });
  await page.reload(); await openSketch(page);
  const canvas=page.locator('[data-sketch-canvas]'); await canvas.scrollIntoViewIfNeeded();
  await canvas.evaluate(el=>{const ctx=el.getContext('2d'),fill=ctx.fill.bind(ctx),clear=ctx.fillRect.bind(ctx);window.sketchWork={fills:0,clears:0};ctx.fill=(...args)=>{window.sketchWork.fills++;return fill(...args);};ctx.fillRect=(...args)=>{window.sketchWork.clears++;return clear(...args);};});
  const r=await canvas.boundingBox(); await page.mouse.move(r.x+50,r.y+50);await page.mouse.down();await page.mouse.move(r.x+120,r.y+70,{steps:8});
  await canvas.evaluate(()=>{window.sketchWork={fills:0,clears:0};});
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('taskspace-quick-sketch-v1')).length)).toBe(201);
  const work=await page.evaluate(()=>window.sketchWork);
  expect(work.clears).toBe(0);expect(work.fills).toBeLessThan(5);
});

test('ペンツールは保存と同じ上段にまとまり、下スクロールだけで余白が増える', async ({page}) => {
  await page.setViewportSize({width:900,height:700});
  await page.evaluate(()=>localStorage.setItem('taskspace-sketch-paper-v1',JSON.stringify({width:600,height:700})));
  await openSketch(page);
  const board=page.locator('[data-sketch-board]'),canvas=page.locator('[data-sketch-canvas]'),viewport=page.locator('[data-sketch-viewport]');
  await expect(page.locator('[data-sketch-header] [data-sketch-width]')).toHaveCount(1);
  await expect(page.locator('[data-sketch-edge]')).toHaveCount(0);
  await expect(board.locator('footer')).toHaveCount(0);
  const before=Number(await canvas.getAttribute('height'));
  await viewport.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await viewport.hover(); await page.mouse.wheel(0,300);
  await expect.poll(async()=>Number(await canvas.getAttribute('height'))).toBeGreaterThan(before);
  expect(await viewport.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
});

test('ペン専用では手の接触で紙を動かさず、線も追加しない', async ({page}) => {
  await openSketch(page);
  await page.locator('[data-sketch-settings]').click(); await page.locator('[data-sketch-pen-only]').check(); await page.locator('[data-sketch-settings]').click();
  const viewport=page.locator('[data-sketch-viewport]');
  const before=await viewport.evaluate(el=>el.scrollTop);
  await page.locator('[data-sketch-canvas]').evaluate(canvas=>{
    canvas.setPointerCapture=()=>{};canvas.hasPointerCapture=()=>false;
    const r=canvas.getBoundingClientRect();
    for(const [type,y] of [['pointerdown',100],['pointermove',10],['pointerup',10]]) canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,isPrimary:true,pointerId:7,pointerType:'touch',button:0,clientX:r.left+50,clientY:r.top+y}));
  });
  expect(await viewport.evaluate(el=>el.scrollTop)).toBe(before);
  await expect(page.locator('[data-sketch-save]')).toBeDisabled();
});
