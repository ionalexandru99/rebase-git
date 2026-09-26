import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vite-plus";

const conditionTimeout = { poll: { timeout: 10_000 } };

const testProject = (
  name: "compatibility" | "integration" | "unit",
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
  resolve: {
    alias: {
      "#tests-ui": fileURLToPath(new URL("./tests/ui", import.meta.url)),
      "#web": fileURLToPath(new URL("./src/apps/web", import.meta.url)),
    },
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
  resolve: {
    alias: {
      "#desktop": fileURLToPath(new URL("./src/apps/desktop", import.meta.url)),
      "#server": fileURLToPath(new URL("./src/apps/server", import.meta.url)),
      "#tests-integration": fileURLToPath(
        new URL("./tests/integration", import.meta.url),
      ),
      "#tests-support": fileURLToPath(
        new URL("./tests/support", import.meta.url),
      ),
      "#tests-ui": fileURLToPath(new URL("./tests/ui", import.meta.url)),
      "#web": fileURLToPath(new URL("./src/apps/web", import.meta.url)),
    },
  },
  ssr: {
    resolve: {
      conditions: ["rebase-source", "import", "default"],
    },
  },
  test: {
    attachmentsDir: "tests/.artifacts/vitest",
    projects: [
      testProject("unit"),
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
      testProject("compatibility"),
      browserProject("ui", "tests/ui/**/*.test.tsx", {
        setupFiles: ["./tests/ui/setup.ts"],
      }),
    ],
  },
});
