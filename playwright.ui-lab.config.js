import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// 試し場は別ビルド（ui-lab）なので、専用の preview を立てる。
export default defineConfig({
  ...base,
  use: { ...base.use, serviceWorkers: 'block', baseURL: 'http://127.0.0.1:4178' },
  workers: 1,
  testIgnore: [],
  testMatch: ['ui-lab.spec.js'],
  projects: [base.projects[0]],
  webServer: {
    command: 'npm run build:ui-lab && npm run preview -- --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178/ui-lab.html',
    reuseExistingServer: false,
    timeout: 600000,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
});
