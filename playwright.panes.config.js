import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base, workers: 1, testMatch: ['panes.spec.js', 'pane-layout.spec.js'],
  projects: [base.projects[0], { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1600, height: 1200 } } }],
  webServer: { ...base.webServer, reuseExistingServer: false, timeout: 600000 },
});
