import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173/evo/", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      // Pinned Firefox crashes inside axe on initialized pages on this Mac.
      // Keep the functional suite here; full axe scans run in Chromium/WebKit.
      grepInvert: /accessible|WCAG/,
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command:
      "npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/evo/runtime.html",
    reuseExistingServer: false,
    timeout: 30000,
    env: { VITE_BASE_PATH: "/evo/" },
  },
});
