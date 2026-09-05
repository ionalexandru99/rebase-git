import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vite-plus";

const testProject = (
  name: "compatibility" | "integration" | "unit",
  exclude: string[] = [],
) => ({
  extends: true as const,
  test: {
    environment: "node" as const,
    ...(exclude.length === 0 ? {} : { exclude }),
    include: [`tests/${name}/**/*.test.ts`],
    name,
  },
});

const browserProject = (
  name: "integration-browser" | "ui",
  include: string,
  setupFiles?: string[],
) => ({
  extends: "./src/apps/web/vite.config.ts",
  resolve: {
    alias: {
      "#tests-ui": fileURLToPath(new URL("./tests/ui", import.meta.url)),
      "#web": fileURLToPath(new URL("./src/apps/web", import.meta.url)),
      "#web-ui": fileURLToPath(new URL("./src/apps/web", import.meta.url)),
    },
  },
  test: {
    browser: {
      enabled: true,
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
    include: [include],
    name,
    ...(setupFiles === undefined ? {} : { setupFiles }),
  },
});

export default defineConfig({
  resolve: {
    alias: {
      "#desktop": fileURLToPath(new URL("./src/apps/desktop", import.meta.url)),
      "#server": fileURLToPath(new URL("./src/apps/server", import.meta.url)),
      "#tests-performance": fileURLToPath(
        new URL("./tests/performance", import.meta.url),
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
      testProject("integration", ["tests/integration/**/*.browser.test.ts"]),
      browserProject(
        "integration-browser",
        "tests/integration/**/*.browser.test.{ts,tsx}",
      ),
      testProject("compatibility"),
      browserProject("ui", "tests/ui/**/*.test.tsx", ["./tests/ui/setup.ts"]),
    ],
  },
});
