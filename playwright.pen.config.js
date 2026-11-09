import { defineConfig, devices } from "@playwright/test";
import process from "node:process";
export default defineConfig({
  testDir: "./tests", testMatch: ["pen-lab.spec.js", "ink-lab.spec.js"], workers: 1, timeout: 60000,
  use: { baseURL: "http://127.0.0.1:4174", trace: "retain-on-failure", screenshot: "only-on-failure", viewport: { width: 393, height: 800 } },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium" } } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: { command: `"${process.execPath}" node_modules/vite/bin/vite.js build --mode pen-preview && "${process.execPath}" node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174 --strictPort`, url: "http://127.0.0.1:4174/pen-lab.html", timeout: 600000, reuseExistingServer: false },
});
