import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('PowerSyncの未確定入力はDBに保存でき、再起動後も送信待ちを作らず残る', async ({ page }) => {
  const url = `/?engine=powersync&offline=1&input=bound&doc=draft-${randomUUID()}`;
  await page.goto(url);
  await page.waitForFunction(() => !!window.lab);
  await page.evaluate(async () => {
    await window.lab.saveInputDraft('row-0', '編集前', 'にほん');
    await window.lab.saveInputDraft('row-0', '編集前', 'にほんご');
    await window.lab.localBarrier();
  });
  expect(await page.evaluate(() => window.lab.queued())).toBe(false);
  await page.goto(url);
  await page.waitForFunction(() => !!window.lab);
  expect(await page.evaluate(() => window.lab.inputState('row-0'))).toEqual({ base: '編集前', text: 'にほんご', draft: true });
  expect(await page.evaluate(() => window.lab.queued())).toBe(false);
  await expect(page.locator('[data-error]')).toBeEmpty();
});
