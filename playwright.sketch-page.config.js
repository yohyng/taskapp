import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({ ...base, use: { ...base.use, serviceWorkers: 'block' }, workers: 1, testMatch: ['sketch-page.spec.js', 'ink-thin.spec.js'], projects: [base.projects[0], { name: 'webkit', use: { ...devices['Desktop Safari'] } }], webServer: { ...base.webServer, reuseExistingServer: false, timeout: 600000 } });
