import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// 各端末は別の保存領域を持つが、同じ本物のWebSocketサーバーに接続する。
async function devices(browser, engine, use) {
  const doc = `test-${randomUUID()}`;
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors = [];
  for (const page of pages) page.on('pageerror', (error) => errors.push(error.message));
  try {
    await Promise.all(pages.map((page) => page.goto(`http://127.0.0.1:4180/?doc=${doc}&engine=${engine}`)));
    await Promise.all(pages.map((page) => expect(page.locator('[data-row]')).toHaveCount(30, { timeout: 60000 })));
    await Promise.all(pages.map((page) => page.waitForFunction(() => !!window.lab)));
    await use(pages, doc);
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
}
const rows = (page) => page.evaluate(() => window.lab.snapshot());
const text = (page) => page.locator('[data-row="row-0"] textarea');
async function converged(pages) {
  await expect.poll(async () => {
    const snapshots = await Promise.all(pages.map(rows));
    return snapshots.every((item) => JSON.stringify(item) === JSON.stringify(snapshots[0]));
  }).toBe(true);
  await expect.poll(async () => {
    const server = await pages[0].evaluate(() => window.lab.serverState());
    return JSON.stringify(server.rows) === JSON.stringify(await rows(pages[0]));
  }).toBe(true);
}

for (const engine of (process.env.LAB_POWERSYNC === '1' ? ['yjs', 'powersync'] : ['yjs'])) test.describe(engine, () => {
test('三端末で続きを書き、開いただけの端末は内容を書き戻さない', async ({ browser }) => {
  await devices(browser, engine, async (pages, doc) => {
    await text(pages[0]).fill('PCで書いた続き');
    await expect(text(pages[1])).toHaveValue('PCで書いた続き');
    await text(pages[1]).fill('PCで書いた続き、スマホから追記');
    await expect(text(pages[2])).toHaveValue('PCで書いた続き、スマホから追記');
    await text(pages[2]).fill('PCで書いた続き、スマホから追記、iPadも追記');
    await converged(pages);
    const before = await pages[0].evaluate(() => window.lab.serverState());
    await pages[2].goto(`http://127.0.0.1:4180/?doc=${doc}&engine=${engine}`);
    await expect(text(pages[2])).toHaveValue('PCで書いた続き、スマホから追記、iPadも追記');
    await pages[2].evaluate(() => window.lab.localBarrier());
    const after = await pages[0].evaluate(() => window.lab.serverState());
    expect(after.changes).toBe(before.changes);
  });
});

test('圏外の端末で追記し、別端末のお気に入りと両方を残す', async ({ browser }) => {
  await devices(browser, engine, async (pages) => {
    await pages[0].evaluate(() => window.lab.disconnect());
    await text(pages[0]).fill('最初のメモ、圏外で追記');
    await pages[0].evaluate(() => window.lab.localBarrier());
    await pages[1].locator('[data-row="row-0"] [data-attribute="favorite"]').check();
    await expect(pages[2].locator('[data-row="row-0"] [data-attribute="favorite"]')).toBeChecked();
    await pages[0].evaluate(() => window.lab.connect());
    await converged(pages);
    expect((await rows(pages[0]))[0]).toMatchObject({ text: '最初のメモ、圏外で追記', favorite: true });
  });
});

test('圏外の編集を再読み込み後も残し、接続後に最新へ合流する', async ({ browser }) => {
  await devices(browser, engine, async (pages, doc) => {
    await pages[0].evaluate(() => window.lab.disconnect());
    await text(pages[0]).fill('再起動しても残す下書き');
    await pages[0].evaluate(() => window.lab.localBarrier());
    await pages[0].goto(`http://127.0.0.1:4180/?doc=${doc}&offline=1&engine=${engine}`);
    await expect(text(pages[0])).toHaveValue('再起動しても残す下書き');
    await pages[1].locator('[data-row="row-1"] textarea').fill('別の行も更新');
    await pages[0].evaluate(() => window.lab.connect());
    await converged(pages);
    expect((await rows(pages[0]))[1].text).toBe('別の行も更新');
  });
});

test('自分の本文をUndoしても、別端末のお気に入りは戻さない', async ({ browser }) => {
  await devices(browser, engine, async (pages) => {
    await text(pages[0]).fill('自分の追記');
    await converged(pages);
    await pages[1].locator('[data-row="row-0"] [data-attribute="favorite"]').check();
    await converged(pages);
    await pages[0].locator('[data-undo]').click();
    await expect(text(pages[1])).toHaveValue('最初のメモ');
    await converged(pages);
    expect((await rows(pages[0]))[0].favorite).toBe(true);
  });
});

if (engine === 'yjs') test('同じ本文への別々の追加を残し、Undoは自分の追加だけを戻す', async ({ browser }) => {
  await devices(browser, engine, async (pages) => {
    await pages[0].evaluate(() => window.lab.disconnect());
    await pages[1].evaluate(() => window.lab.disconnect());
    await pages[0].evaluate(() => window.lab.insertText('row-0', 0, 'PCの追記：'));
    await pages[1].evaluate(() => window.lab.insertText('row-0', 0, 'スマホの追記：'));
    await Promise.all(pages.slice(0, 2).map((page) => page.evaluate(() => window.lab.localBarrier())));
    await Promise.all(pages.slice(0, 2).map((page) => page.evaluate(() => window.lab.connect())));
    await converged(pages);
    const merged = (await rows(pages[0]))[0].text;
    expect(merged).toContain('PCの追記：');
    expect(merged).toContain('スマホの追記：');
    await pages[0].locator('[data-undo]').click();
    await converged(pages);
    const after = (await rows(pages[0]))[0].text;
    expect(after).not.toContain('PCの追記：');
    expect(after).toContain('スマホの追記：');
  });
});

if (engine === 'powersync') {
  test('同じ本文の両立できない変更は両方を別々に保全する', async ({ browser }) => {
    await devices(browser, engine, async (pages) => {
      await pages[0].evaluate(() => window.lab.disconnect());
      await pages[1].evaluate(() => window.lab.disconnect());
      await text(pages[0]).fill('PCで書いた本文');
      await text(pages[1]).fill('スマホで書いた本文');
      await Promise.all(pages.slice(0, 2).map((page) => page.evaluate(() => window.lab.localBarrier())));
      await pages[0].evaluate(() => window.lab.connect());
      await expect(text(pages[2])).toHaveValue('PCで書いた本文');
      await pages[1].evaluate(() => window.lab.connect());
      await expect.poll(() => pages[2].evaluate(() => window.lab.conflicts().length)).toBe(1);
      await converged(pages);
      const state = await pages[0].evaluate(() => window.lab.serverState());
      expect(state.conflicts[0]).toMatchObject({ mine: JSON.stringify('スマホで書いた本文'), theirs: JSON.stringify('PCで書いた本文') });
      await expect(pages[1].locator('[data-conflicts]')).toContainText('スマホで書いた本文');
    });
  });
  test('保存後の返事を失った再送でも操作を一度だけ適用する', async ({ browser }) => {
    await devices(browser, engine, async (pages) => {
      let lost = false;
      const before = await pages[0].evaluate(() => window.lab.serverState());
      await pages[0].route('**/lab/powersync/upload', async (route) => {
        if (lost) return route.continue();
        lost = true;
        await route.fetch();
        await route.abort('failed');
      });
      await text(pages[0]).fill('返事がなくても一度だけ保存');
      await expect.poll(async () => (await pages[2].evaluate(() => window.lab.serverState())).changes, { timeout: 30000 }).toBe(before.changes + 1);
      await expect(text(pages[2])).toHaveValue('返事がなくても一度だけ保存');
      await expect.poll(() => pages[0].locator('[data-status]').textContent(), { timeout: 30000 }).toContain('通信上の未確認なし');
      await converged(pages);
      expect((await pages[0].evaluate(() => window.lab.serverState())).changes).toBe(before.changes + 1);
      expect(lost).toBe(true);
    });
  });
}
});
