import { test, expect } from '@playwright/test';
import { appFixture } from './support/app-fixture.mjs';

test('接続ランプ：同期済みは緑の丸を表示し、切断中は待機して復帰後に再び同期済みになる', async ({ browser }) => {
  const f = await appFixture(browser);
  try {
    const a = await f.open(), b = await f.open();
    const link = a.locator('[data-outline-link]'), status = a.locator('[data-sync]');
    await expect(status).toHaveAttribute('data-sync', 'synced');
    await expect(status).toHaveText('');
    await a.locator('[data-outline-sync-detail]').click();
    await expect(status).toHaveText('同期済み');
    await a.locator('[data-outline-sync-detail]').click();
    await expect(status).toHaveText('');
    await expect(link).toHaveAttribute('data-link', 'live');
    await expect(link).toHaveText('●');
    await expect(link).toHaveAttribute('title', 'ほかの端末とつながっています（押すと読み直す）');
    f.offline.add(a);
    await a.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(link).toHaveAttribute('data-link', 'waking');
    await expect(link).toHaveText('◌');
    await a.locator('[data-row="memo"] [data-row-text]').click();
    await a.locator('[data-row="memo"] textarea').fill('圏外の入力も復帰後に届ける');
    await a.evaluate(() => window.lab.localBarrier());
    await expect(status).toHaveAttribute('data-sync', 'waiting');
    f.offline.delete(a);
    await a.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(b.locator('[data-row="memo"] [data-row-text]')).toHaveText('圏外の入力も復帰後に届ける');
    await expect(status).toHaveAttribute('data-sync', 'synced');
    await expect(link).toHaveAttribute('data-link', 'live');
    await expect(link).toHaveText('●');
    expect(f.legacy).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('通常の入口：タスク・分割画面・メモ追加を新同期へ渡し、StrictModeでも旧同期を起動しない', async ({ browser }) => {
  const f = await appFixture(browser);
  try {
    const a = await f.open(), b = await f.open();
    await expect(a.locator('[data-pane="tasks"] [data-task-id="task-probe"]')).toBeVisible();
    await expect(a.locator('[data-pane="outline"] [data-row="memo"]')).toBeVisible();
    expect(f.entries).toHaveLength(0);
    await expect(a.locator('[data-outline-recovery],[data-session-signout]')).toHaveCount(0);
    await a.locator('[data-row="memo"] [data-row-text]').click();
    await a.locator('[data-row="memo"] textarea').fill('普段の画面から編集');
    await expect(b.locator('[data-row="memo"] [data-row-text]')).toHaveText('普段の画面から編集');
    await a.locator('[data-quick-add]').click();
    await a.locator('[data-quick-add-dialog] textarea').fill('タスク画面からメモへ追加🌿');
    await a.locator('[data-add-memo]').click(); await a.locator('[data-quick-add-dialog] textarea').press('Escape');
    await expect.poll(() => b.evaluate(() => window.lab.snapshot().filter((row) => row.text === 'タスク画面からメモへ追加🌿').length)).toBe(1);
    await a.locator('[data-pane-add]').click();
    await a.locator('[data-pane-add-split]').click();
    await expect(a.locator('[data-outliner]')).toHaveCount(2);
    await expect(a.locator('[data-row="memo"] [data-row-text]')).toHaveCount(2);
    await a.locator('[data-outline-view]').first().click();
    await expect(a.locator('[data-outline-pull],[data-outline-clear]')).toHaveCount(0);
    expect(await a.evaluate(() => JSON.parse(localStorage.getItem('taskspace-outline-view')).fontSize)).toBe(22);
    await a.evaluate(() => window.lab.localBarrier()); await a.reload();
    await expect(a.locator('[data-outliner]')).toHaveCount(2);
    await expect.poll(() => a.evaluate(() => window.lab.snapshot().filter((row) => row.text === 'タスク画面からメモへ追加🌿').length)).toBe(1);
    expect(await a.evaluate(() => localStorage.getItem('taskspace-outline-v1'))).toBe('[{"id":"legacy","text":"旧保存は残す","children":[]}]');
    expect(f.legacy).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});


test('直接入力：全体比較を通らず同期し、改行とインデント後も入力を続けられる', async ({ browser }) => {
  const f = await appFixture(browser);
  try {
    const a = await f.open(), b = await f.open();
    await a.evaluate(() => {
      const original = window.lab.changeOutline;
      window.__restoreOutlineChange = () => { window.lab.changeOutline = original; };
      window.lab.changeOutline = () => { throw new Error('文字入力で全体比較を呼びました'); };
    });
    await a.locator('[data-row="memo"] [data-row-text]').click();
    const input = a.locator('[data-row="memo"] textarea'); await input.fill('直接入力の本文');
    await expect(b.locator('[data-row="memo"] [data-row-text]')).toHaveText('直接入力の本文');
    await a.evaluate(async () => {
      await window.lab.localBarrier();
      if (window.lab.outline() !== window.lab.outline()) throw new Error('状態通知で木を再生成しました');
      window.__restoreOutlineChange();
    });
    await input.press('End'); await input.press('Enter');
    const next = a.locator('[data-outliner] textarea'); await next.fill('改行した子'); await next.press('Tab');
    await expect.poll(() => b.evaluate(() => window.lab.snapshot().find((row) => row.text === '改行した子')?.parentId)).toBe('memo');
    await next.press('Shift+Tab');
    await expect.poll(() => b.evaluate(() => window.lab.snapshot().find((row) => row.text === '改行した子')?.parentId)).not.toBe('memo');
    expect(f.errors).toEqual([]); expect(f.legacy).toEqual([]);
  } finally { await f.close(); }
});
