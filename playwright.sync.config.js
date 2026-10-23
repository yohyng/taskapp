import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

// 通信だけを差し替えて、実際のProvider・IndexedDB・画面を確かめる。
// 通常の回帰テストとは別のポートを使い、本番の鍵を渡さない。
export default defineConfig({
  testDir: "./sync-tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: "http://127.0.0.1:4174",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4174 --strictPort`,
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" },
  },
});
