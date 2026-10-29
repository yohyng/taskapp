import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const input = (page, id = 'row-0') => page.getByRole('textbox', { name: `${id}の本文`, exact: true });
const row = (page, id = 'row-0') => page.evaluate((id) => window.lab.snapshot().find((row) => row.id === id), id);
async function fixture(browser, use, query = '') {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage())), errors = [];
  const doc = `loro-${randomUUID()}`, url = `/?engine=loro&doc=${doc}&input=bound&tree=1${query}`;
  for (const page of pages) page.on('pageerror', (error) => errors.push(error.message));
  try {
    await Promise.all(pages.map((page) => page.goto(url)));
    for (const page of pages) { await expect(page.locator('[data-row]')).toHaveCount(30, { timeout: 60000 }); await page.waitForFunction(() => !!window.lab); }
    await use(pages, url);
    for (const page of pages) await expect(page.locator('[data-error]')).toBeEmpty();
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
}
async function settled(pages) {
  await Promise.all(pages.map((page) => page.evaluate(() => window.lab.localBarrier())));
  await expect.poll(async () => (await Promise.all(pages.map((page) => page.evaluate(() => window.lab.queued())))).every((value) => !value)).toBe(true);
  await expect.poll(async () => {
    const server = await pages[0].evaluate(() => window.lab.serverState());
    return (await Promise.all(pages.map((page) => page.evaluate(() => window.lab.snapshot())))).every((value) => JSON.stringify(value) === JSON.stringify(server.rows));
  }).toBe(true);
}

test('Loro：初期化した入力欄では一回目から保存し、別端末の画面へ反映する', async ({ browser }) => {
  await fixture(browser, async (pages) => {
    await input(pages[0]).fill('最初の入力');
    await expect(input(pages[2])).toHaveText('最初の入力'); await settled(pages);
  });
});

test('Loro：本文と属性の受信は変更行だけを更新し、空の通信では同じ表示世代を保つ', async ({ browser }) => {
  await fixture(browser, async (pages) => {
    await settled(pages);
    const before = await pages[2].evaluate(() => window.lab.projectionStats());
    await input(pages[0]).focus(); await input(pages[0]).press('ControlOrMeta+End'); await pages[0].keyboard.insertText('・変更行だけ');
    await expect(input(pages[2])).toHaveText('最初のメモ・変更行だけ');
    await pages[0].locator('[data-row="row-3"] [data-attribute="favorite"]').check();
    await expect(pages[2].locator('[data-row="row-3"] [data-attribute="favorite"]')).toBeChecked();
    await settled(pages);
    const after = await pages[2].evaluate(() => { window.observedRows = window.lab.snapshot(); return window.lab.projectionStats(); });
    expect(after.fullRebuilds).toBe(before.fullRebuilds);
    expect(after.incrementalRowReads - before.incrementalRowReads).toBe(2);
    for (let i = 0; i < 2; i++) await pages[2].waitForResponse((response) => response.url().includes('/lab/loro/sync?') && response.status() === 200);
    expect(await pages[2].evaluate(() => window.lab.projectionStats())).toEqual(after);
    expect(await pages[2].evaluate(() => window.observedRows === window.lab.snapshot())).toBe(true);
  });
});

test('Loro：保存完了待ちの間に次の編集が増えた場合も、両方の端末確定まで送らない', async ({ browser }) => {
  await fixture(browser, async (pages) => {
    const a = pages[0]; await settled(pages); await a.evaluate(() => window.lab.disconnect());
    await a.evaluate(() => {
      window.confirmations = []; window.originalAdd = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) {
        if (this.name === 'updates' && this.transaction.db.name.startsWith('taskspace-lab-loro-')) Object.defineProperty(this.transaction, 'oncomplete', {
          set(callback) { this.addEventListener('complete', (event) => window.confirmations.push(() => callback(event))); },
        });
        return window.originalAdd.apply(this, args);
      };
    });
    try {
      await input(a).fill('保存待ち1');
      await expect.poll(() => a.evaluate(() => window.confirmations.length)).toBe(1);
      await a.evaluate(() => { window.waitingConnect = window.lab.connect(); });
      await input(a).fill('保存待ち2');
      await a.evaluate(() => window.confirmations[0]());
      await expect.poll(() => a.evaluate(() => window.confirmations.length)).toBe(2);
      const sentEarly = await a.waitForRequest((request) => request.url().includes('/lab/loro/sync?') && request.postDataJSON().updates.length > 0, { timeout: 500 }).then(() => true, () => false);
      expect(sentEarly).toBe(false);
      await a.evaluate(() => { IDBObjectStore.prototype.add = window.originalAdd; window.confirmations[1](); });
      await expect(input(pages[2])).toHaveText('保存待ち2'); await settled(pages);
    } finally { await a.evaluate(() => { IDBObjectStore.prototype.add = window.originalAdd; for (const complete of window.confirmations) complete(); }); }
  });
});

test('Loro：壊れた更新を含む送信は部分反映せず、正しい再送だけを保存する', async ({ browser }) => {
  await fixture(browser, async (pages) => {
    await settled(pages);
    const payload = await pages[0].evaluate(() => {
      const source = window.lab.loroBinding('row-0').rawSource, doc = source.fork(), from = source.oplogVersion();
      try {
        const node = doc.getTree('outline').getNodes().find((item) => item.data.get('id') === 'row-0');
        node.data.get('text').insert(0, '再送：'); doc.commit();
        return { version: [...from.encode()], update: [...doc.export({ mode: 'update', from })] };
      } finally { from.free(); doc.free(); }
    });
    const before = await pages[2].evaluate(() => window.lab.serverState());
    const status = await pages[0].evaluate(async ({ version, update }) => {
      const broken = update.slice(); broken[Math.floor(broken.length / 2)] ^= 1;
      return (await fetch(`/lab/loro/sync?doc=${new URLSearchParams(location.search).get('doc')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, updates: [update, broken] }) })).status;
    }, payload);
    expect(status).toBe(500);
    expect(await pages[2].evaluate(() => window.lab.serverState())).toEqual(before);
    expect(await pages[0].evaluate(async ({ version, update }) => (await fetch(`/lab/loro/sync?doc=${new URLSearchParams(location.search).get('doc')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, updates: [update] }) })).status, payload)).toBe(200);
    await expect(input(pages[2])).toHaveText('再送：最初のメモ'); await settled(pages);
  });
});

test('Loro：木・属性・二行の本文が一度に届くと素の接続は表示を取りこぼし、行別の接続では両方反映する', async ({ browser }) => {
  await fixture(browser, async (pages) => {
    await pages[0].evaluate(() => window.lab.editBatch());
    await expect.poll(async () => (await row(pages[2])).text).toBe('同じ受信：最初のメモ');
    await expect.poll(async () => (await row(pages[2], 'row-3')).text).toBe('別の行：検証用の行 3');
    const shown = await Promise.all([input(pages[2]).textContent(), input(pages[2], 'row-3').textContent()]);
    expect(shown).not.toEqual(['同じ受信：最初のメモ', '別の行：検証用の行 3']);
  }, '&binding=raw');
  await fixture(browser, async (pages) => {
    await pages[0].evaluate(() => window.lab.editBatch());
    for (const page of pages) {
      await expect(input(page)).toHaveText('同じ受信：最初のメモ');
      await expect(input(page, 'row-3')).toHaveText('別の行：検証用の行 3');
      await expect(page.locator('[data-row="row-0"] [data-attribute="favorite"]')).toBeChecked();
      await expect(page.locator('[data-row="row-3"]')).toHaveAttribute('data-tree-depth', '2');
    }
    await settled(pages);
  });
});

test('Loro：別々の入力欄のUndoとRedoは編集した行へ戻り、別端末の本文を消さない', async ({ browser }) => {
  await fixture(browser, async (pages) => {
    const a = pages[0];
    await input(a).focus(); await input(a).press('ControlOrMeta+End'); await a.keyboard.insertText('・自分0');
    await input(a, 'row-3').focus(); await input(a, 'row-3').press('ControlOrMeta+End'); await a.keyboard.insertText('・自分3');
    await settled(pages);
    await pages[1].evaluate(() => window.lab.insertText('row-3', 0, '別端末：'));
    await expect(input(a, 'row-3')).toHaveText('別端末：検証用の行 3・自分3');
    await input(a, 'row-3').press('ControlOrMeta+z');
    await expect(input(a, 'row-3')).toHaveText('別端末：検証用の行 3');
    await expect(input(a, 'row-3')).toBeFocused();
    await input(a, 'row-3').press('ControlOrMeta+z');
    await expect(input(a)).toHaveText('最初のメモ'); await expect(input(a)).toBeFocused();
    await input(a).press('ControlOrMeta+Shift+Z');
    await expect(input(a)).toHaveText('最初のメモ・自分0');
    await input(a).press('ControlOrMeta+Shift+Z');
    await expect(input(a, 'row-3')).toHaveText('別端末：検証用の行 3・自分3');
    await expect(input(a, 'row-3')).toBeFocused(); await settled(pages);
  });
});

test('Loro：保存後の返事を失って開き直しても、残った送信待ちを重複適用しない', async ({ browser }) => {
  await fixture(browser, async (pages, url) => {
    const a = pages[0], before = await pages[2].evaluate(() => window.lab.serverState());
    let lost = false;
    await a.route('**/lab/loro/sync?*', async (route) => {
      if (!route.request().postDataJSON().updates.length) return route.continue();
      if (!lost) { await route.fetch(); lost = true; }
      await route.abort('failed');
    });
    await input(a).fill('返事を失っても残る');
    await expect.poll(() => lost).toBe(true);
    await a.evaluate(() => window.lab.disconnect()); await a.evaluate(() => window.lab.localBarrier());
    await a.goto(`${url}&offline=1`); await a.waitForFunction(() => !!window.lab);
    await expect(input(a)).toHaveText('返事を失っても残る');
    expect(await a.evaluate(() => window.lab.queued())).toBe(true);
    await a.unroute('**/lab/loro/sync?*'); await a.evaluate(() => window.lab.connect());
    await settled(pages);
    expect((await pages[2].evaluate(() => window.lab.serverState())).changes).toBe(before.changes + 1);
  });
});

test('Loro：返事を待つ間の次の入力を、前の送信の完了で消さない', async ({ browser }) => {
  await fixture(browser, async (pages) => {
    const a = pages[0]; let held = false, release;
    const gate = new Promise((resolve) => { release = resolve; });
    await a.route('**/lab/loro/sync?*', async (route) => {
      if (held || !route.request().postDataJSON().updates.length) return route.continue();
      const response = await route.fetch(); held = true; await gate; await route.fulfill({ response });
    });
    try {
      await input(a).fill('先の入力'); await expect.poll(() => held).toBe(true);
      await input(a).press('ControlOrMeta+End'); await a.keyboard.insertText('・次の入力');
      await a.evaluate(() => window.lab.localBarrier()); release();
      await expect(input(pages[2])).toHaveText('先の入力・次の入力'); await settled(pages);
    } finally { release(); }
  });
});

test('Loro：相互移動後の木とネイティブIDを、圏外再読み込み後も保つ', async ({ browser }) => {
  await fixture(browser, async (pages, url) => {
    const before = await pages[0].evaluate(() => window.lab.nativeIds());
    await pages[0].evaluate(() => window.lab.disconnect()); await pages[1].evaluate(() => window.lab.disconnect());
    await pages[0].evaluate(() => window.lab.moveBranch('row-1', 'row-2'));
    await pages[1].evaluate(() => window.lab.moveBranch('row-2', 'row-1'));
    await Promise.all(pages.slice(0, 2).map((page) => page.evaluate(() => window.lab.localBarrier())));
    await Promise.all(pages.slice(0, 2).map((page) => page.evaluate(() => window.lab.connect()))); await settled(pages);
    const server = await pages[2].evaluate(() => window.lab.serverState());
    await pages[0].goto(`${url}&offline=1`); await pages[0].waitForFunction(() => !!window.lab);
    expect(await pages[0].evaluate(() => window.lab.nativeIds())).toEqual(before);
    await expect(pages[0].locator('[data-row][data-tree-visible="true"]')).toHaveCount(30);
    await pages[0].evaluate(() => window.lab.connect()); await settled(pages);
    expect((await pages[2].evaluate(() => window.lab.serverState())).changes).toBe(server.changes);
  });
});

test('Loro：差分を自動でまとめ直しても圏外の本文と送信待ちを保ち、再接続で全端末へ届ける', async ({ browser }) => {
  await fixture(browser, async (pages, url) => {
    const a = pages[0]; await settled(pages); await a.evaluate(() => window.lab.disconnect());
    const before = await a.evaluate(() => window.lab.persistenceStats());
    await a.evaluate(async () => {
      for (let i = 0; i < 140; i++) window.lab.insertText('row-0', 0, 'あ');
      await window.lab.localBarrier();
    });
    await expect.poll(() => a.evaluate(() => window.lab.persistenceStats().compactions)).toBeGreaterThan(before.compactions);
    const expected = await a.evaluate(() => window.lab.snapshot());
    const after = await a.evaluate(() => window.lab.persistenceStats());
    expect(after.checkpointExports - before.checkpointExports).toBe(1);
    expect(after.appendedUpdates - before.appendedUpdates).toBe(140);
    expect(after.appendedBytes - before.appendedBytes).toBeLessThan(140 * 1024);
    await a.goto(`${url}&offline=1`); await a.waitForFunction(() => !!window.lab);
    expect(await a.evaluate(() => window.lab.snapshot())).toEqual(expected);
    expect(await a.evaluate(() => window.lab.queued())).toBe(true);
    await a.evaluate(() => window.lab.connect()); await settled(pages);
  });
});

test('Loro：任意のまとめ直しが中止されても追記を続けられ、再試行と再読み込みで内容を保つ', async ({ browser }) => {
  await fixture(browser, async (pages, url) => {
    const a = pages[0]; await settled(pages); await a.evaluate(() => window.lab.disconnect());
    await a.evaluate(() => {
      window.originalCheckpointPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = window.originalCheckpointPut.apply(this, args);
        if (this.name === 'state' && this.transaction.db.name.startsWith('taskspace-lab-loro-')) this.transaction.abort();
        return request;
      };
    });
    try {
      await a.evaluate(async () => { for (let i = 0; i < 130; i++) window.lab.insertText('row-0', 0, 'あ'); await window.lab.localBarrier(); });
      await expect.poll(() => a.evaluate(() => window.lab.persistenceStats().compactionFailures)).toBe(1);
    } finally { await a.evaluate(() => { IDBObjectStore.prototype.put = window.originalCheckpointPut; }); }
    await input(a).press('ControlOrMeta+End'); await a.keyboard.insertText('・続けられる');
    await a.evaluate(() => window.lab.localBarrier());
    const expected = await a.evaluate(() => window.lab.snapshot());
    await a.evaluate(() => window.lab.compactLocal());
    await a.goto(`${url}&offline=1`); await a.waitForFunction(() => !!window.lab);
    expect(await a.evaluate(() => window.lab.snapshot())).toEqual(expected);
    await a.evaluate(() => window.lab.connect()); await settled(pages);
  });
});
