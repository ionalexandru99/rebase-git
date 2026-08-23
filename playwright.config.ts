import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  outputDir: "tests/.artifacts/playwright",
  reporter: process.env.CI ? "github" : "list",
  testDir: "tests/e2e",
  webServer: {
    command: "pnpm dev:web --host 127.0.0.1 --strictPort",
    reuseExistingServer: !process.env.CI,
    url: "http://127.0.0.1:4173",
  },
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "browser",
      testMatch: "**/*.browser.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.REBASE_E2E_BASE_URL ?? "http://127.0.0.1:4173",
      },
    },
    {
      name: "electron",
      testMatch: "**/*.electron.spec.ts",
    },
    {
      name: "packaged-electron",
      testMatch: "**/*.packaged-electron.spec.ts",
    },
  ],
});
