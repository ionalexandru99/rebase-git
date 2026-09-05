import { defineConfig } from "@playwright/test";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  outputDir: "tests/.artifacts/playwright-release-smoke",
  reporter: [
    [process.env.CI ? "github" : "list"],
    [
      "html",
      { open: "never", outputFolder: "tests/.artifacts/release-smoke-report" },
    ],
    ["junit", { outputFile: "tests/.artifacts/release-smoke.xml" }],
  ],
  testDir: "tests/release-smoke",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "release-smoke",
      testMatch: "**/*.release-smoke.test.ts",
    },
  ],
});
