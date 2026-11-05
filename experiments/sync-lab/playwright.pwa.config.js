import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';

// 通常試験のサーバーと並走させない。成果物を両方生成し終えてから、一つのURLで切り替える。
export default defineConfig({
  testDir: './tests', testMatch: '**/pwa-update.spec.js', workers: 1, retries: 0, timeout: 180000,
  expect: { timeout: 20000 }, use: { baseURL: 'http://127.0.0.1:4183', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }, { name: 'webkit', use: devices['Desktop Safari'] }],
  webServer: { command: `"${process.execPath}" scripts/serve-app-preview.mjs`, url: 'http://127.0.0.1:4183', reuseExistingServer: false,
    timeout: 120000, env: { LAB_VERIFY_PWA_UPDATE: '1' } },
});
