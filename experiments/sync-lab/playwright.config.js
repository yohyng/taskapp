import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';
export default defineConfig({
  testDir: './tests', workers: 1, retries: 0, timeout: 90000,
  expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:4180', serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `"${process.execPath}" scripts/dev.mjs`, url: 'http://127.0.0.1:4180', reuseExistingServer: false, timeout: 30000,
  },
});
