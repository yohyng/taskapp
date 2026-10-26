import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const engines = process.env.LAB_POWERSYNC === '1' ? ['yjs', 'powersync', 'loro'] : ['yjs', 'loro'];
const pathFor = (engine, offline = false) => `/benchmark.html?engine=${engine}${offline ? '&offline=1' : ''}`;
const snapshot = (page) => page.evaluate(() => window.bench.engine.snapshot());
const text = (page) => page.locator('[data-editor]');
async function ready(page) {
  await page.waitForFunction(() => window.bench && window.bench.metrics.rowsFrameMs !== undefined, null, { timeout: 90000 });
  await expect(page.locator('[data-visible] li')).toHaveCount(60);
  await expect(page.locator('[data-error]')).toBeEmpty();
}
async function confirmed(page) {
  await page.evaluate(() => window.bench.engine.localBarrier());
  await expect.poll(() => page.evaluate(() => window.bench.engine.queued()), { timeout: 60000 }).toBe(false);
}
const digest = (rows) => createHash('sha256').update(JSON.stringify([...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0))).digest('hex');
function intact(rows, engine) {
  assert.equal(rows.length, 10000);
  assert.equal(new Set(rows.map((row) => row.id)).size, 10000);
  for (const row of rows) {
    const i = Number(row.id.slice(4));
    assert.ok(Number.isInteger(i) && i >= 0 && i < 10000, row.id);
    assert.equal(row.parentId, i > 2 && i < 10 ? 'row-1' : null, row.id);
    assert.equal(row.order, engine === 'loro' ? i >= 10 ? i - 7 : i >= 3 ? i - 3 : i : i, row.id);
    if (i !== 0) assert.equal(row.text, `検証用の行 ${i}`, row.id);
    if (i !== 1) assert.equal(row.favorite, false, row.id);
    assert.equal(row.deleted, false, row.id); assert.equal(row.completed, false, row.id);
  }
}

for (const engine of engines) test(`${engine}：一万行の起動・保存・持ち替えを三回測り、全行を照合する`, async ({ browser, request }, info) => {
  // この試験は別ジョブの空のDBで実施。同じ一文書を再使用し、全体配信の対象を増やさない。
  if (engine === 'yjs') expect((await request.get('/lab/benchmark/seed')).ok()).toBe(true);
  if (engine === 'powersync') expect((await request.get('/lab/powersync/token?doc=benchmark-10000')).ok()).toBe(true);
  if (engine === 'loro') expect((await request.get('/lab/loro/server-state?doc=benchmark-10000')).ok()).toBe(true);
  // Viteの初回変換とPowerSyncの初回取り込みを測定から外す。端末は毎回新しい保存領域で開く。
  const preparation = await browser.newContext();
  try { const page = await preparation.newPage(); await page.goto(pathFor(engine)); await ready(page); await confirmed(page); await page.evaluate(() => window.bench.engine.dispose()); }
  finally { await preparation.close(); }
  const result = { engine, browser: info.project.name, version: browser.version(), platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, memoryBytes: os.totalmem(), node: process.version, revision: process.env.GITHUB_SHA || 'local', samples: [] };
  for (let trial = 0; trial < 3; trial++) {
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const [a, b] = await Promise.all(contexts.map((context) => context.newPage()));
    const errors = [];
    for (const page of [a, b]) page.on('pageerror', (error) => errors.push(error.message));
    try {
      await a.goto(pathFor(engine)); await ready(a); await confirmed(a);
      const coldA = await a.evaluate(() => window.bench.metrics);
      const before = await a.evaluate(() => window.bench.engine.serverState());
      intact(before.rows, engine);
      const beforeFavorite = before.rows.find((row) => row.id === 'row-1').favorite;
      await b.goto(pathFor(engine)); await ready(b); await confirmed(b);
      const coldB = await b.evaluate(() => window.bench.metrics);
      expect(digest(await snapshot(a))).toBe(digest(before.rows));
      expect(digest(await snapshot(b))).toBe(digest(before.rows));
      expect((await a.evaluate(() => window.bench.engine.serverState())).changes).toBe(before.changes);
      const edits = [];
      for (let input = 0; input < 3; input++) {
        const value = `${await text(a).inputValue()}・${info.project.name}-${trial}-${input}`;
        const started = performance.now();
        await text(a).fill(value);
        await expect(text(b)).toHaveValue(value, { timeout: 60000 });
        const remoteMs = performance.now() - started;
        await a.waitForFunction(() => window.bench.metrics.input.at(-1)?.localMs !== undefined && window.bench.metrics.input.at(-1)?.frameMs !== undefined);
        const sample = await a.evaluate(() => window.bench.metrics.input.at(-1));
        await confirmed(a);
        await expect.poll(async () => (await a.evaluate(() => window.bench.engine.serverState())).rows.find((row) => row.id === 'row-0')?.text, { timeout: 60000 }).toBe(value);
        edits.push({ localMs: sample.localMs, frameMs: sample.frameMs, remoteObservedMs: remoteMs, serverConfirmedMs: performance.now() - started });
      }
      await a.evaluate(() => window.bench.engine.disconnect());
      await a.goto(pathFor(engine, true)); await ready(a);
      const warm = await a.evaluate(() => window.bench.metrics);
      expect(digest(await snapshot(a))).toBe(digest(await snapshot(b)));
      const offlineValue = `${await text(a).inputValue()}・圏外-${trial}`;
      await text(a).fill(offlineValue);
      await a.waitForFunction(() => window.bench.metrics.input.at(-1)?.localMs !== undefined);
      await a.goto(pathFor(engine, true)); await ready(a);
      await expect(text(a)).toHaveValue(offlineValue);
      await b.evaluate(() => window.bench.engine.setAttribute('row-1', 'favorite', !window.bench.engine.snapshot().find((row) => row.id === 'row-1').favorite));
      await confirmed(b);
      await a.evaluate(() => window.bench.engine.connect());
      await expect(text(b)).toHaveValue(offlineValue, { timeout: 60000 });
      await confirmed(a); await confirmed(b);
      // 送信待ちの完了と、Hocuspocusのdebounceされた永続化は別。実ファイルも追いつくまで照合する。
      await expect.poll(async () => digest(await snapshot(a)) === digest(await snapshot(b)), { timeout: 60000 }).toBe(true);
      const expected = digest(await snapshot(a));
      await expect.poll(async () => digest((await a.evaluate(() => window.bench.engine.serverState())).rows), { timeout: 60000 }).toBe(expected);
      const final = await a.evaluate(() => window.bench.engine.serverState());
      await expect.poll(async () => digest(await snapshot(a)), { timeout: 60000 }).toBe(digest(final.rows));
      await expect.poll(async () => digest(await snapshot(b)), { timeout: 60000 }).toBe(digest(final.rows));
      intact(final.rows, engine);
      expect(final.rows.find((row) => row.id === 'row-1').favorite).toBe(!beforeFavorite);
      await expect(a.locator('[data-error]')).toBeEmpty(); await expect(b.locator('[data-error]')).toBeEmpty();
      expect(errors).toEqual([]);
      result.samples.push({ trial, coldA, coldB, warmOffline: warm, edits, rows: final.rows.length, storageRepresentationBytes: final.bytes });
      console.log(`BENCH_TRIAL ${engine}/${info.project.name}/${trial} 全行一致`);
      if (engine === 'loro' && trial === 2) {
        await a.evaluate(() => window.bench.engine.disconnect()); await b.evaluate(() => window.bench.engine.disconnect());
        result.encodingImport = await a.evaluate(async () => {
          const { LoroDoc } = await import('/src/loro-runtime.js');
          const { loroViewRows } = await import('/src/loro-model.js');
          const source = window.bench.engine.loroBinding('row-0').rawSource;
          const expected = JSON.stringify(loroViewRows(source)), measurements = [];
          // 通信・画面を止め、同じ履歴を二形式で復元する。初回取り込みの遅さをライブラリー全体の順位にしない。
          for (const mode of ['snapshot', 'update']) {
            const bytes = source.export({ mode });
            for (let repeat = 0; repeat < 3; repeat++) {
              const doc = new LoroDoc(), started = performance.now();
              try {
                doc.import(bytes);
                const imported = performance.now(), rows = loroViewRows(doc), projected = performance.now();
                measurements.push({ mode, repeat, bytes: bytes.length, importMs: imported - started, projectionMs: projected - imported, allRowsMatch: JSON.stringify(rows) === expected });
              } finally { doc.free(); }
            }
          }
          return measurements;
        });
        expect(result.encodingImport.every((sample) => sample.allRowsMatch)).toBe(true);
      }
    } finally {
      for (const page of [a, b]) await page.evaluate(async () => { await window.bench?.engine.dispose(); }).catch(() => {});
      await Promise.all(contexts.map((context) => context.close()));
    }
  }
  await mkdir('.bench-results', { recursive: true });
  const filename = `.bench-results/${info.project.name}-${engine}.json`;
  await writeFile(filename, JSON.stringify(result, null, 2));
  await info.attach('一万行の測定値', { path: filename, contentType: 'application/json' });
  console.log(`BENCH_RESULT ${JSON.stringify(result)}`);
});
