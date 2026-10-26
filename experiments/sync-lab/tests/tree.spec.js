import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { analyzeTree } from '../src/tree-model.js';

const getRows = (page) => page.evaluate(() => window.lab.snapshot());
const getTree = (page) => page.evaluate(() => window.lab.treeState());
const editor = (page, id) => page.getByRole('textbox', { name: `${id}の本文`, exact: true });
const shown = (page) => page.locator('[data-row][data-tree-visible="true"]');
async function fixture(browser, engine, use) {
  const doc = `tree-${randomUUID()}`;
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const url = `/?engine=${engine}&doc=${doc}&tree=1&input=bound`, errors = [];
  for (const page of pages) page.on('pageerror', (error) => errors.push(error.message));
  try {
    await Promise.all(pages.map((page) => page.goto(url)));
    for (const page of pages) { await expect(shown(page)).toHaveCount(30, { timeout: 60000 }); await page.waitForFunction(() => !!window.lab); }
    await use(pages, url);
    for (const page of pages) await expect(page.locator('[data-error]')).toBeEmpty();
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
}
async function settled(pages) {
  await Promise.all(pages.map((page) => page.evaluate(() => window.lab.localBarrier())));
  await expect.poll(async () => (await Promise.all(pages.map((page) => page.evaluate(() => window.lab.queued())))).every((item) => !item)).toBe(true);
  await expect.poll(async () => {
    const data = await Promise.all(pages.map(getRows)), server = await pages[0].evaluate(() => window.lab.serverState());
    return data.every((item) => JSON.stringify(item) === JSON.stringify(server.rows));
  }).toBe(true);
}
async function move(page, id, parent) {
  await page.locator(`[data-row="${id}"] [data-tree-parent]`).selectOption(parent || '');
  await page.locator(`[data-row="${id}"] [data-tree-move]`).click();
}
for (const engine of (process.env.LAB_POWERSYNC === '1' ? ['yjs', 'powersync'] : ['yjs'])) test.describe(`木・${engine}`, () => {
  test('枝を移しても本文と子のIDを保ち、Undoで別端末の編集を消さない', async ({ browser }) => {
    await fixture(browser, engine, async (pages) => {
      await move(pages[0], 'row-1', 'row-2');
      await expect.poll(async () => (await getRows(pages[2])).find((row) => row.id === 'row-1').parentId).toBe('row-2');
      await expect(pages[2].locator('[data-row="row-3"]')).toHaveAttribute('data-tree-depth', '2');
      await settled(pages);
      const moved = (await getRows(pages[1])).find((row) => row.id === 'row-1');
      const beforeNoop = await pages[2].evaluate(() => window.lab.serverState());
      await pages[1].evaluate((moved) => window.lab.moveBranch('row-1', moved.parentId, moved.order, { parentId: null, order: 1 }), moved);
      await settled(pages);
      expect((await pages[2].evaluate(() => window.lab.serverState())).changes).toBe(beforeNoop.changes);
      await editor(pages[1], 'row-3').fill('移動した枝の中から追記');
      await pages[1].locator('[data-row="row-1"] [data-attribute="favorite"]').check();
      await expect.poll(async () => (await getRows(pages[2])).find((row) => row.id === 'row-3').text).toBe('移動した枝の中から追記');
      await settled(pages);
      await pages[0].locator('[data-undo]').click();
      await expect.poll(async () => (await getRows(pages[2])).find((row) => row.id === 'row-1').parentId).toBe(null);
      await settled(pages);
      const rows = await getRows(pages[2]);
      expect(rows).toHaveLength(30); expect(new Set(rows.map((row) => row.id)).size).toBe(30);
      expect(rows.find((row) => row.id === 'row-3')).toMatchObject({ text: '移動した枝の中から追記', parentId: 'row-1' });
      expect(rows.find((row) => row.id === 'row-1').favorite).toBe(true);
    });
  });
  test('兄弟の先頭への並べ替えが全端末で一致する', async ({ browser }) => {
    await fixture(browser, engine, async (pages) => {
      await pages[0].locator('[data-row="row-5"] [data-tree-first]').click();
      await expect.poll(async () => (await getTree(pages[2])).visible.filter((row) => row.parentId === 'row-1')[0].id).toBe('row-5');
      await settled(pages);
      expect((await getTree(pages[2])).issues.cycles).toEqual([]);
    });
  });
  test('枝の削除中に古い端末で編集しても保全し、Undoで最新の本文ごと戻す', async ({ browser }) => {
    await fixture(browser, engine, async (pages) => {
      await pages[1].evaluate(() => window.lab.disconnect());
      await pages[0].locator('[data-row="row-1"] [data-tree-delete]').click();
      await expect(shown(pages[2])).toHaveCount(22);
      await expect(pages[2].locator('[data-row="row-1"]')).not.toBeVisible();
      await expect(pages[2].locator('[data-row="row-3"]')).not.toBeVisible();
      await editor(pages[1], 'row-3').fill('削除を知らなかった端末の追記');
      await pages[1].evaluate(() => window.lab.localBarrier());
      await pages[1].evaluate(() => window.lab.connect());
      await settled(pages);
      await expect(pages[2].locator('[data-trash-row="row-3"]')).toContainText('削除を知らなかった端末の追記');
      expect((await getRows(pages[2]))).toHaveLength(30);
      await pages[0].locator('[data-undo]').click();
      await expect(shown(pages[2])).toHaveCount(30);
      await settled(pages);
      expect((await getRows(pages[2])).find((row) => row.id === 'row-3').text).toBe('削除を知らなかった端末の追記');
    });
  });
  test('削除と競合しても、親の外へ移した子の枝は巻き込まない', async ({ browser }) => {
    await fixture(browser, engine, async (pages) => {
      await pages[1].evaluate(() => window.lab.disconnect());
      await move(pages[1], 'row-3', null);
      await pages[1].evaluate(() => window.lab.localBarrier());
      await pages[0].locator('[data-row="row-1"] [data-tree-delete]').click();
      await expect(shown(pages[2])).toHaveCount(22);
      await pages[1].evaluate(() => window.lab.connect());
      await expect(shown(pages[2])).toHaveCount(23);
      await settled(pages);
      expect((await getTree(pages[2])).visible.find((row) => row.id === 'row-3').parentId).toBe(null);
      expect((await getTree(pages[2])).trash.map((row) => row.id)).not.toContain('row-3');
    });
  });
  test('古い未編集端末を開き直しても削除した枝を復活させない', async ({ browser }) => {
    await fixture(browser, engine, async (pages, url) => {
      await pages[0].evaluate(() => window.lab.disconnect());
      await pages[0].evaluate(() => window.lab.localBarrier());
      await pages[1].locator('[data-row="row-1"] [data-tree-delete]').click();
      await expect(shown(pages[2])).toHaveCount(22);
      const before = await pages[2].evaluate(() => window.lab.serverState());
      await pages[0].goto(`${url}&offline=1`);
      await expect(shown(pages[0])).toHaveCount(30);
      await pages[0].waitForFunction(() => !!window.lab);
      await pages[0].evaluate(() => window.lab.connect());
      await expect(shown(pages[0])).toHaveCount(22);
      await settled(pages);
      expect((await pages[2].evaluate(() => window.lab.serverState())).changes).toBe(before.changes);
    });
  });
  test('相互に親を入れ替える移動は、単純な親ID方式の限界とDB側の拒否を分けて確認する', async ({ browser }) => {
    await fixture(browser, engine, async (pages) => {
      await pages[0].evaluate(() => window.lab.disconnect()); await pages[1].evaluate(() => window.lab.disconnect());
      await move(pages[0], 'row-1', 'row-2'); await move(pages[1], 'row-2', 'row-1');
      await Promise.all(pages.slice(0, 2).map((page) => page.evaluate(() => window.lab.localBarrier())));
      await Promise.all(pages.slice(0, 2).map((page) => page.evaluate(() => window.lab.connect())));
      await settled(pages);
      const server = await pages[2].evaluate(() => window.lab.serverState());
      if (engine === 'yjs') {
        expect(analyzeTree(server.rows).issues.cycles).toEqual([['row-1', 'row-2']]);
        await expect(pages[2].locator('[data-unplaced-row]')).toHaveCount(9);
        expect((await getTree(pages[2])).visible.length + (await getTree(pages[2])).detached.length).toBe(30);
        const before = server.changes;
        await pages[2].reload(); await pages[2].waitForFunction(() => !!window.lab);
        await expect(pages[2].locator('[data-unplaced-row]')).toHaveCount(9);
        expect((await pages[2].evaluate(() => window.lab.serverState())).changes).toBe(before);
        await pages[2].locator('[data-unplaced-row="row-1"] [data-recover-root]').click();
        await expect(shown(pages[0])).toHaveCount(30);
        await settled(pages);
      } else {
        expect(analyzeTree(server.rows).issues.cycles).toEqual([]);
        expect(server.conflicts).toHaveLength(1);
        expect(JSON.parse(server.conflicts[0].theirs).reason).toBe('cycle');
        await expect(shown(pages[2])).toHaveCount(30);
      }
    });
  });
  test('同じ枝の別々の移動で、移動先と並び順が半分ずつ混ざらない', async ({ browser }) => {
    await fixture(browser, engine, async (pages) => {
      await pages[0].evaluate(() => window.lab.disconnect()); await pages[1].evaluate(() => window.lab.disconnect());
      await pages[0].evaluate(() => window.lab.moveBranch('row-1', 'row-2', 100));
      await pages[1].evaluate(() => window.lab.moveBranch('row-1', 'row-10', 200));
      await Promise.all(pages.slice(0, 2).map((page) => page.evaluate(() => window.lab.localBarrier())));
      await Promise.all(pages.slice(0, 2).map((page) => page.evaluate(() => window.lab.connect())));
      await settled(pages);
      const row = (await getRows(pages[2])).find((item) => item.id === 'row-1');
      expect([{ parentId: 'row-2', order: 100 }, { parentId: 'row-10', order: 200 }]).toContainEqual({ parentId: row.parentId, order: row.order });
      expect((await getRows(pages[2])).find((item) => item.id === 'row-3').parentId).toBe('row-1');
      if (engine === 'powersync') expect(await pages[2].evaluate(() => window.lab.conflicts().length)).toBe(1);
    });
  });
  test('削除を知らない端末がその親へ移したときも、枝の本文を失わない', async ({ browser }) => {
    await fixture(browser, engine, async (pages) => {
      await pages[1].evaluate(() => window.lab.disconnect());
      await pages[0].locator('[data-row="row-2"] [data-tree-delete]').click();
      await expect(shown(pages[2])).toHaveCount(29);
      await move(pages[1], 'row-1', 'row-2');
      await editor(pages[1], 'row-3').fill('古い端末からの枝の追記');
      await pages[1].evaluate(() => window.lab.localBarrier()); await pages[1].evaluate(() => window.lab.connect());
      await settled(pages);
      expect((await getRows(pages[2])).find((row) => row.id === 'row-3').text).toBe('古い端末からの枝の追記');
      if (engine === 'yjs') {
        await expect(pages[2].locator('[data-trash-row="row-3"]')).toContainText('古い端末からの枝の追記');
        await pages[2].locator('[data-trash-row="row-1"] [data-trash-rehome]').click();
        await expect(shown(pages[2])).toHaveCount(29);
        await settled(pages);
      } else {
        expect((await getRows(pages[2])).find((row) => row.id === 'row-1').parentId).toBe(null);
        expect(JSON.parse((await pages[2].evaluate(() => window.lab.serverState())).conflicts[0].theirs).reason).toBe('deleted-parent');
        await expect(shown(pages[2])).toHaveCount(29);
      }
    });
  });
});
