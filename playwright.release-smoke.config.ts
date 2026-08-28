import { defineConfig } from "@playwright/test";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  outputDir: "tests/.artifacts/playwright-release-smoke",
  reporter: process.env.CI ? "github" : "list",
  testDir: "tests/release-smoke",
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "release-smoke",
      testMatch: "**/*.release-smoke.spec.ts",
    },
  ],
});
