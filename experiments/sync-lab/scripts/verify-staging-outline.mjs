import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, webkit } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { verificationConfig } from './verify-supabase-staging.mjs';

// 明示実行する実サービス試験。ログイン情報をViteの環境変数へ入れず、trace・画像・認証値も出力しない。
const root = fileURLToPath(new URL('..', import.meta.url));
const env = parseEnv(await readFile(new URL('../.env.verify.local', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(env.LAB_STAGING_MANIFEST, 'utf8'));
const config = verificationConfig(env, manifest);
const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, storageKey: randomUUID() } });
let server, phase = '設定', completed = 0;
const timeout = { timeout: 20000 };
async function head() {
  const result = await client.from('taskspace_loro_documents').select('head').eq('id', config.docId).single().abortSignal(AbortSignal.timeout(10000));
  if (result.error) throw new Error('検証文書のheadを取得できない');
  return result.data.head;
}
const text = (page, id) => page.evaluate((id) => window.lab.snapshot().find((row) => row.id === id)?.text, id);
async function opened(page) {
  await page.waitForFunction(() => !!window.lab, null, timeout);
  await page.locator('[data-row="probe"]').waitFor({ state: 'visible', ...timeout });
}
async function saved(page) {
  await page.evaluate(() => window.lab.localBarrier());
  await page.waitForFunction(() => !window.lab.queued() && window.lab.connectionState().connected, null, timeout);
}
async function equals(page, id, value) {
  await page.waitForFunction(({ id, value }) => window.lab.snapshot().find((row) => row.id === id)?.text === value, { id, value }, timeout);
}
async function edit(page, id, value) {
  await page.locator(`[data-row="${id}"] [data-row-text]`).click(timeout);
  await page.locator(`[data-row="${id}"] textarea`).fill(value, timeout);
}
try {
  const signed = await client.auth.signInWithPassword({ email: env.LAB_OWNER_EMAIL, password: env.LAB_OWNER_PASSWORD });
  if (signed.error || signed.data.user.id !== manifest.documents[0].ownerId) throw new Error('テストユーザーが一致しない');
  // 手元の公開設定へも同じ検証先を固定し、別プロジェクトへログイン情報を渡さない。
  server = await createServer({ root, mode: 'staging', define: { __LAB_STAGING__: JSON.stringify(config) },
    server: { host: '127.0.0.1', port: 4180, strictPort: true, open: false }, logLevel: 'error' });
  await server.listen();
  for (const [name, browserType] of [['Chromium', chromium], ['WebKit', webkit]]) {
    let browser;
    try {
      phase = `${name}の起動`; browser = await browserType.launch({ headless: true });
      const contexts = await Promise.all([browser.newContext({ serviceWorkers: 'block' }), browser.newContext({ serviceWorkers: 'block' })]);
      const beforeHead = await head(), pages = [];
      for (const context of contexts) {
        phase = `${name}のログイン`;
        const page = await context.newPage(); await page.goto('http://127.0.0.1:4180/outline.html', { waitUntil: 'domcontentloaded' });
        await page.getByPlaceholder('メールアドレス').fill(env.LAB_OWNER_EMAIL, timeout);
        await page.getByPlaceholder('パスワード').fill(env.LAB_OWNER_PASSWORD, timeout);
        await page.getByRole('button', { name: 'ログイン', exact: true }).click(timeout);
        await opened(page); await saved(page); pages.push(page);
      }
      assert.equal(await head(), beforeHead, '開いただけで書き戻している');
      const [a, b] = pages;
      phase = `${name}の本文同期・再読込`;
      const value = await text(a, 'probe') + `・画面検証${randomUUID()}`;
      await edit(a, 'probe', value); await saved(a); await equals(b, 'probe', value);
      const afterHead = await head();
      await a.reload({ waitUntil: 'domcontentloaded' }); await opened(a); await saved(a); await equals(a, 'probe', value);
      assert.equal(await head(), afterHead, '再読込から余分な保存が起きている');
      completed++; console.log(`${name}：本体画面のログイン・二接続の本文同期・再読込・開くだけの非書込みが成功`);

      phase = `${name}のAPI停止中の端末保存・再読込・復帰`;
      const blocked = `${config.url}/rest/v1/**`, abort = (route) => route.abort('failed');
      await a.route(blocked, abort);
      const offlineValue = value + `・未送信${randomUUID()}`, remoteValue = await text(b, 'other') + `・別接続${randomUUID()}`;
      await edit(a, 'probe', offlineValue); await a.evaluate(() => window.lab.localBarrier());
      assert.equal(await a.evaluate(() => window.lab.queued()), true);
      await edit(b, 'other', remoteValue); await saved(b);
      await a.reload({ waitUntil: 'domcontentloaded' }); await opened(a); await equals(a, 'probe', offlineValue);
      assert.equal(await a.evaluate(() => window.lab.queued()), true, '未送信の再読込で送信待ちを失っている');
      await a.unroute(blocked, abort); await a.evaluate(() => window.dispatchEvent(new Event('online')));
      await saved(a); await equals(a, 'other', remoteValue); await equals(b, 'probe', offlineValue);
      assert.equal(await a.locator('[data-outline-sync-conflict]').count(), 0);
      completed++; console.log(`${name}：API停止中の未送信保存・再読込・別行との自動統合が成功`);
    } finally { await browser?.close(); }
  }
  console.log(JSON.stringify({ projectRef: config.reference, browserScenarios: completed, productOutliner: true, productionChanged: false }));
} catch (error) {
  // Playwrightの操作エラーには入力値が含まれ得る。生の例外やスクリーンショットをログへ出さない。
  console.error(JSON.stringify({ complete: false, phase, errorType: error.name, browserScenarios: completed })); process.exitCode = 1;
} finally { await server?.close(); await client.removeAllChannels(); await client.auth.stopAutoRefresh(); }
