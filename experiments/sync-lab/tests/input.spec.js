import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const input = (page) => page.getByRole('textbox', { name: 'row-0の本文', exact: true });
const rowText = (page) => page.evaluate(() => window.lab.snapshot()[0].text);
async function fixture(browser, engine, use) {
  const doc = `input-${randomUUID()}`;
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors = [];
  for (const page of pages) page.on('pageerror', (error) => errors.push(error.message));
  try {
    await Promise.all(pages.map((page) => page.goto(`/?doc=${doc}&engine=${engine}&input=bound`)));
    for (const page of pages) {
      await expect(page.locator('[data-row]')).toHaveCount(30, { timeout: 60000 });
      await page.waitForFunction(() => !!window.lab);
    }
    await use(pages, doc);
    for (const page of pages) await expect(page.locator('[data-error]')).toBeEmpty();
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
}
async function settled(pages) {
  await Promise.all(pages.map((page) => page.evaluate(() => window.lab.localBarrier())));
  await expect.poll(async () => (await Promise.all(pages.map((page) => page.evaluate(() => window.lab.queued())))).every((item) => !item)).toBe(true);
  await expect.poll(async () => {
    const data = await Promise.all(pages.map((page) => page.evaluate(() => window.lab.snapshot())));
    const server = await pages[0].evaluate(() => window.lab.serverState());
    return data.every((item) => JSON.stringify(item) === JSON.stringify(server.rows));
  }).toBe(true);
}
async function compose(page, browserName) {
  const box = input(page);
  await box.focus();
  await box.press('ControlOrMeta+End');
  if (browserName === 'chromium') {
    // Chromiumの入力プロトコルで変換を開始・確定する。実OSの候補選択とは別の検証。
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
    return {
      finish: async () => { await cdp.send('Input.insertText', { text: '日本語' }); await cdp.detach(); },
      cancel: async () => { await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }); await cdp.detach(); },
    };
  }
  // WebKitには同じ入力APIがないため、DOMの変換イベント列を模擬する。
  await box.dispatchEvent('compositionstart', { data: '' });
  await page.keyboard.insertText('にほん');
  const selectCandidate = () => box.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const start = node.textContent.indexOf('にほん');
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start); range.setEnd(node, start + 3);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        return;
      }
      // 旧textareaとの対照試験用。新しい入力欄ではDOMの範囲を使う。
      if (element instanceof HTMLTextAreaElement) element.setSelectionRange(element.value.indexOf('にほん'), element.value.indexOf('にほん') + 3);
    });
  return { finish: async () => {
    await selectCandidate();
    await page.keyboard.insertText('日本語');
    await box.dispatchEvent('compositionend', { data: '日本語' });
  }, cancel: async () => {
    await selectCandidate();
    await box.press('Backspace');
    await box.dispatchEvent('compositionend', { data: '' });
  } };
}

for (const engine of (process.env.LAB_POWERSYNC === '1' ? ['yjs', 'powersync'] : ['yjs'])) test.describe(`入力・${engine}`, () => {
  test('変換中に別端末が追記しても、確定した日本語と受信内容を両方残す', async ({ browser, browserName }) => {
    await fixture(browser, engine, async (pages) => {
      const composition = await compose(pages[0], browserName);
      await input(pages[1]).focus();
      await input(pages[1]).press('ControlOrMeta+Home');
      await pages[1].keyboard.insertText('別端末：');
      await expect.poll(() => rowText(pages[2])).toContain('別端末：');
      await expect.poll(() => rowText(pages[0])).toContain('別端末：');
      await composition.finish();
      if (engine === 'yjs') {
        await expect.poll(() => rowText(pages[2])).toContain('日本語');
        await settled(pages);
        expect(await rowText(pages[2])).toBe('別端末：最初のメモ日本語');
        expect(await rowText(pages[2])).not.toContain('にほん');
      } else {
        await expect.poll(() => pages[2].evaluate(() => window.lab.conflicts().length)).toBe(1);
        await settled(pages);
        const state = await pages[2].evaluate(() => window.lab.serverState());
        expect(state.conflicts[0]).toMatchObject({ mine: JSON.stringify('最初のメモ日本語'), theirs: JSON.stringify('別端末：最初のメモ') });
      }
    });
  });

  test('変換中に別端末が属性だけを変えた場合は、確認を求めず両方を保存する', async ({ browser, browserName }) => {
    await fixture(browser, engine, async (pages) => {
      const composition = await compose(pages[0], browserName);
      await pages[1].locator('[data-row="row-0"] [data-attribute="favorite"]').check();
      await expect(pages[2].locator('[data-row="row-0"] [data-attribute="favorite"]')).toBeChecked();
      await composition.finish();
      await expect.poll(() => rowText(pages[2])).toBe('最初のメモ日本語');
      await settled(pages);
      expect((await pages[2].evaluate(() => window.lab.snapshot()))[0].favorite).toBe(true);
      if (engine === 'powersync') expect(await pages[2].evaluate(() => window.lab.conflicts().length)).toBe(0);
    });
  });

  test('変換を取り消しても受信した追記を残し、余計な競合を作らない', async ({ browser, browserName }) => {
    await fixture(browser, engine, async (pages) => {
      const composition = await compose(pages[0], browserName);
      await input(pages[1]).focus();
      await input(pages[1]).press('ControlOrMeta+Home');
      await pages[1].keyboard.insertText('別端末：');
      await expect.poll(() => rowText(pages[2])).toContain('別端末：');
      const before = await pages[2].evaluate(() => window.lab.serverState());
      await composition.cancel();
      await expect.poll(() => rowText(pages[2])).toBe('別端末：最初のメモ');
      await settled(pages);
      if (engine === 'powersync') {
        expect(await pages[2].evaluate(() => window.lab.conflicts().length)).toBe(0);
        expect((await pages[2].evaluate(() => window.lab.serverState())).changes).toBe(before.changes);
      }
    });
  });

  test('絵文字・改行・選択した範囲の置換を三端末へ保存する', async ({ browser }) => {
    await fixture(browser, engine, async (pages, doc) => {
      const text = '日本語👩🏽‍💻\n二行目・貼り付け';
      await input(pages[0]).fill(text);
      await expect.poll(() => rowText(pages[2])).toBe(text);
      await input(pages[0]).press('ControlOrMeta+Home');
      await input(pages[0]).press('Shift+ArrowRight');
      await input(pages[0]).press('Shift+ArrowRight');
      await pages[0].keyboard.insertText('にほん');
      await expect.poll(() => rowText(pages[1])).toBe('にほん語👩🏽‍💻\n二行目・貼り付け');
      await settled(pages);
      const before = await pages[2].evaluate(() => window.lab.serverState());
      await pages[0].goto(`/?doc=${doc}&engine=${engine}&input=bound`);
      await pages[0].waitForFunction(() => !!window.lab);
      await expect.poll(() => rowText(pages[0])).toBe('にほん語👩🏽‍💻\n二行目・貼り付け');
      expect((await pages[2].evaluate(() => window.lab.serverState())).changes).toBe(before.changes);
    });
  });

  test('圏外の変換途中の入力を、開き直しても端末内に残す', async ({ browser, browserName }) => {
    await fixture(browser, engine, async (pages, doc) => {
      await pages[0].evaluate(() => window.lab.disconnect());
      await compose(pages[0], browserName);
      await expect.poll(() => pages[0].evaluate(() => window.lab.inputState('row-0').text)).toContain('にほん');
      await pages[0].evaluate(() => window.lab.localBarrier());
      await pages[0].goto(`/?doc=${doc}&engine=${engine}&input=bound&offline=1`);
      await pages[0].waitForFunction(() => !!window.lab);
      await expect.poll(() => pages[0].evaluate(() => window.labInput.text('row-0'))).toContain('にほん');
      await expect(pages[0].locator('[data-status]')).toContainText('圏外・再接続待ち');
      // PowerSyncの未確定入力は復元表示だけでは送らず、再度入力してから保存する。
      await pages[0].evaluate(() => window.lab.connect());
      if (engine === 'powersync') {
        await expect(pages[0].locator('[data-status]')).toContainText('接続中');
        await pages[0].evaluate(() => window.lab.localBarrier());
        expect((await pages[2].evaluate(() => window.lab.serverState())).rows[0].text).toBe('最初のメモ');
        expect(await pages[0].evaluate(() => window.lab.inputState('row-0').draft)).toBe(true);
      }
      await input(pages[0]).press('ControlOrMeta+End');
      await pages[0].keyboard.insertText('の続き');
      await expect.poll(() => rowText(pages[2])).toContain('にほんの続き');
      await settled(pages);
    });
  });

  if (engine === 'yjs') test('入力欄のUndoは別端末の追記を消さず、自分の入力だけ戻す', async ({ browser }) => {
    await fixture(browser, engine, async (pages) => {
      await input(pages[0]).focus();
      await input(pages[0]).press('ControlOrMeta+End');
      await pages[0].keyboard.insertText('・自分');
      await expect.poll(() => rowText(pages[2])).toContain('・自分');
      await input(pages[1]).focus();
      await input(pages[1]).press('ControlOrMeta+Home');
      await pages[1].keyboard.insertText('別端末：');
      await expect.poll(() => rowText(pages[0])).toContain('別端末：');
      await input(pages[0]).press('ControlOrMeta+z');
      await expect.poll(() => rowText(pages[2])).toBe('別端末：最初のメモ');
      await settled(pages);
      await input(pages[0]).press('ControlOrMeta+Shift+Z');
      await expect.poll(() => rowText(pages[2])).toBe('別端末：最初のメモ・自分');
      await settled(pages);
    });
  });

  if (engine === 'powersync') test('DBが受信済みでも、利用者が見ていた古い本文を最新扱いしない', async ({ browser }) => {
    await fixture(browser, engine, async (pages) => {
      const seen = await rowText(pages[0]);
      await input(pages[1]).fill('別端末の本文');
      await expect.poll(() => rowText(pages[0])).toBe('別端末の本文');
      await pages[0].evaluate(({ seen }) => window.lab.replaceObservedText('row-0', seen, `${seen}・手元の追記`), { seen });
      await expect.poll(() => pages[2].evaluate(() => window.lab.conflicts().length)).toBe(1);
      await settled(pages);
      const state = await pages[2].evaluate(() => window.lab.serverState());
      expect(state.rows[0].text).toBe('別端末の本文');
      expect(state.conflicts[0]).toMatchObject({ mine: JSON.stringify('最初のメモ・手元の追記'), theirs: JSON.stringify('別端末の本文') });
    });
  });
});
