import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  outputDir: "tests/.artifacts/performance",
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"],
    },
  ],
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: "tests/.artifacts/performance-report" },
    ],
    ["json", { outputFile: "tests/.artifacts/performance.json" }],
  ],
  testDir: "tests/performance",
  timeout: 60_000,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  workers: 1,
});
