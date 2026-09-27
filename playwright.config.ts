import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  outputDir: "tests/.artifacts/playwright",
  reporter: [
    [process.env.CI ? "github" : "list"],
    ["html", { open: "never", outputFolder: "tests/.artifacts/e2e-report" }],
    ["junit", { outputFile: "tests/.artifacts/e2e.xml" }],
  ],
  testDir: "tests/e2e",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "browser",
      testMatch: "**/*.browser.test.ts",
      use: devices["Desktop Chrome"],
    },
    {
      name: "electron",
      testMatch: "**/*.electron.test.ts",
    },
  ],
});
