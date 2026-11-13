import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// 計測ページは別ビルド（ink-diag）なので、専用の preview を立てる。
export default defineConfig({
  ...base,
  use: { ...base.use, serviceWorkers: 'block', baseURL: 'http://127.0.0.1:4176' },
  workers: 1,
  testMatch: ['ink-diag.spec.js'],
  projects: [base.projects[0]],
  webServer: {
    command: 'npm run build:ink-diag && npm run preview -- --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176/ink-diag.html',
    reuseExistingServer: false,
    timeout: 600000,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
});
