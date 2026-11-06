import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base, testIgnore: [], testMatch: '**/performance.spec.js', timeout: 600000,
  // 全行のevaluate結果と通信本文を記録する費用を、計測する処理へ加えない。
  use: { ...base.use, trace: 'off' },
  // PWA用previewを負荷測定へ混ぜず、比較用サーバーだけを一万行モードで起動する。
  webServer: { ...base.webServer[0], env: { LAB_BENCHMARK: '1' } },
});
