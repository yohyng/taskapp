import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base, testIgnore: [], testMatch: '**/performance.spec.js', timeout: 600000,
  // 全行のevaluate結果と通信本文を記録する費用を、計測する処理へ加えない。
  use: { ...base.use, trace: 'off' },
  webServer: { ...base.webServer, env: { LAB_BENCHMARK: '1' } },
});
