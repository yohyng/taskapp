import { test, expect, storedTasks } from './helpers.js';
import { installVoiceMock } from './support/voice-recognition.js';

const input = (page) => page.locator('[data-quick-add-dialog] textarea');
const mic = (page) => page.locator('[data-quick-add-voice]');
const emit = (page, words) => page.evaluate((words) => window.voiceProbe.sessions.at(-1).emit(words), words);

test.beforeEach(async ({ page }) => {
  await installVoiceMock(page);
  await page.locator('[data-quick-add]').click();
});

test('音声入力：カーソル位置に入れ、途中結果と重複イベントを追記しない', async ({ page }) => {
  await input(page).fill('前後');
  await input(page).evaluate((el) => el.setSelectionRange(1, 1));
  await mic(page).click();
  await expect(mic(page)).toHaveAttribute('data-voice-phase', 'listening');
  await emit(page, ['声']);
  await expect(input(page)).toHaveValue('前声後');
  await emit(page, ['音声のメモ', 'の続き']);
  await emit(page, ['音声のメモ', 'の続き']);
  await expect(input(page)).toHaveValue('前音声のメモの続き後');
  expect(await page.evaluate(() => window.voiceProbe.sessions[0].lang)).toBe('ja-JP');
  await mic(page).click();
  await expect(mic(page)).toHaveAttribute('data-voice-phase', 'idle');
  await expect(input(page)).toHaveValue('前音声のメモの続き後');
});

test('音声入力：追加後の空欄に遅れた結果を入れず、二重追加しない', async ({ page }) => {
  const before = (await storedTasks(page)).length;
  await mic(page).click();
  await emit(page, ['話して追加するタスク']);
  await page.locator('[data-add-task]').click();
  await expect(input(page)).toHaveValue('');
  await page.evaluate(() => window.voiceProbe.sessions[0].lateResult([[{ transcript: '遅れた音声' }]]));
  await expect(input(page)).toHaveValue('');
  await expect.poll(async () => (await storedTasks(page)).length).toBe(before + 1);
  expect(await page.evaluate(() => window.voiceProbe.sessions[0].aborts)).toBe(1);
});

test('音声入力：手で書き直した文字を認識結果で上書きしない', async ({ page }) => {
  await mic(page).click();
  await emit(page, ['途中の言葉']);
  await input(page).fill('手で書き直した言葉');
  await page.evaluate(() => window.voiceProbe.sessions[0].lateResult([[{ transcript: '遅れた音声' }]]));
  await expect(input(page)).toHaveValue('手で書き直した言葉');
  await expect(mic(page)).toHaveAttribute('data-voice-phase', 'idle');
});

test('音声入力：閉じたらマイクを終了し、開き直した欄へ結果を入れない', async ({ page }) => {
  await mic(page).click();
  await input(page).press('Escape');
  await expect(page.locator('[data-quick-add-dialog]')).toHaveCount(0);
  expect(await page.evaluate(() => window.voiceProbe.sessions[0].aborts)).toBe(1);
  await page.locator('[data-quick-add]').click();
  await page.evaluate(() => window.voiceProbe.sessions[0].lateResult([[{ transcript: '閉じた後の音声' }]]));
  await expect(input(page)).toHaveValue('');
});

test('音声入力：許可しない場合も既存の入力を残して手入力できる', async ({ page }) => {
  await input(page).fill('先に書いた言葉');
  await page.evaluate(() => { window.voiceProbe.error = 'not-allowed'; });
  await mic(page).click();
  await expect(page.locator('[data-quick-add-voice-status]')).toContainText('マイクを許可');
  await expect(input(page)).toHaveValue('先に書いた言葉');
  await input(page).fill('手で入力できる');
  await expect(input(page)).toHaveValue('手で入力できる');
});

test('音声入力：非対応ならキーボードのマイクを案内し入力を残す', async ({ page }) => {
  await page.evaluate(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; });
  await input(page).fill('先に書いた言葉');
  await mic(page).click();
  await expect(page.locator('[data-quick-add-voice-status]')).toContainText('キーボードにマイク');
  await expect(input(page)).toHaveValue('先に書いた言葉');
});
