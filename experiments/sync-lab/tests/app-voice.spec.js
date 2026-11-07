import { test, expect } from '@playwright/test';
import { appFixture } from './support/app-fixture.mjs';
import { installVoiceMock } from '../../../tests/support/voice-recognition.js';

test('音声メモ：認識結果を一度だけ追加し、別端末へ届け、マイクを止める', async ({ browser }) => {
  const f = await appFixture({ newContext: (options) => browser.newContext({ ...options, viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true }) });
  try {
    const a = await f.open(), b = await f.open();
    await installVoiceMock(a);
    await a.locator('[data-quick-add]').click();
    await a.locator('[data-quick-add-voice]').click();
    await a.evaluate(() => {
      const session = window.voiceProbe.sessions[0];
      session.emit(['話して残したメモ']);
      session.emit(['話して残したメモ']);
    });
    await expect(a.locator('[data-quick-add-dialog] textarea')).toHaveValue('話して残したメモ');
    await a.locator('[data-add-memo]').click();
    await expect.poll(() => b.evaluate(() => window.lab.snapshot().filter((row) => row.text === '話して残したメモ').length)).toBe(1);
    await a.evaluate(() => window.voiceProbe.sessions[0].lateResult([[{ transcript: '追加後に届いた音声' }]]));
    await expect(a.locator('[data-quick-add-dialog] textarea')).toHaveValue('');
    expect(await a.evaluate(() => window.voiceProbe.sessions[0].aborts)).toBe(1);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});
