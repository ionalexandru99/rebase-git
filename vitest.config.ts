import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vite-plus";

const conditionTimeout = { poll: { timeout: 10_000 } };

const testProject = (
  name: "integration" | "unit",
  test: {
    exclude?: string[];
    expect?: typeof conditionTimeout;
    hookTimeout?: number;
    testTimeout?: number;
  } = {},
) => ({
  extends: true as const,
  test: {
    environment: "node" as const,
    ...test,
    include: [`tests/${name}/**/*.test.ts`],
    name,
  },
});

const browserProject = (
  name: "integration-browser" | "ui",
  include: string,
  test: { setupFiles?: string[]; testTimeout?: number } = {},
) => ({
  extends: "./src/apps/web/vite.config.ts",
  optimizeDeps: {
    include: ["effect/unstable/rpc", "effect/unstable/socket"],
  },
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" as const }],
      provider: playwright(
        name === "integration-browser"
          ? {
              launchOptions: {
                channel: "chromium",
                ignoreDefaultArgs: ["--disable-back-forward-cache"],
              },
            }
          : {},
      ),
      screenshotDirectory: "tests/.artifacts/vitest",
      viewport: { height: 720, width: 1280 },
    },
    expect: conditionTimeout,
    include: [include],
    name,
    ...test,
  },
});

export default defineConfig({
  test: {
    attachmentsDir: "tests/.artifacts/vitest",
    projects: [
      testProject("unit", { expect: conditionTimeout, testTimeout: 30_000 }),
      testProject("integration", {
        exclude: ["tests/integration/**/*.browser.test.ts"],
        expect: conditionTimeout,
        hookTimeout: 30_000,
        testTimeout: 30_000,
      }),
      browserProject(
        "integration-browser",
        "tests/integration/**/*.browser.test.{ts,tsx}",
        { testTimeout: 30_000 },
      ),
      browserProject("ui", "tests/ui/**/*.test.tsx", {
        testTimeout: 30_000,
        setupFiles: ["./tests/ui/setup.ts"],
      }),
    ],
  },
});
