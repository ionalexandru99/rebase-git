import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createServer } from "vite";

test("quota cleanup and cache rebuild keep graph interaction below 50 ms", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixturePath = `/@fs${resolve("tests/performance/fixtures/history-storage-interaction.browser.tsx")}`;
  const server = await createServer({
    configFile: resolve("src/apps/web/vite.config.ts"),
    root: resolve("src/apps/web"),
    resolve: {
      alias: {
        "#web": resolve("src/apps/web"),
        "#web-ui": resolve("src/apps/web"),
      },
    },
    server: { host: "127.0.0.1", port: 0, hmr: false },
    plugins: [
      {
        name: "history-storage-performance",
        configureServer(server) {
          server.middlewares.use(
            "/__storage_performance__",
            async (_request, response) => {
              response.setHeader("Content-Type", "text/html");
              response.end(
                await server.transformIndexHtml(
                  "/__storage_performance__",
                  '<!doctype html><html><head><title>History storage interaction</title><link rel="stylesheet" href="/styles.css"></head><body></body></html>',
                ),
              );
            },
          );
        },
      },
    ],
  });
  await server.listen();
  try {
    const url = server.resolvedUrls?.local[0];
    if (url === undefined) throw new Error("Performance server has no URL");
    await page.goto(`${url}__storage_performance__`);
    await page.evaluate(async (modulePath) => {
      const fixture: {
        prepareStorageInteraction: () => Promise<
          Window["__storageMaintenance"]
        >;
      } = await import(modulePath);
      window.__storageMaintenance = await fixture.prepareStorageInteraction();
    }, fixturePath);
    const grid = page.getByRole("grid", { name: "Commit history" });
    await grid.getByRole("row", { name: /^Storage commit 0,/ }).click();
    await page.keyboard.press("ArrowDown");
    await expect(
      grid.getByRole("row", { name: /^Storage commit 1,/ }),
    ).toHaveAttribute("aria-selected", "true");
    const metrics = await page.evaluate(async () => {
      const grid = document.querySelector<HTMLElement>(
        '[role="grid"][aria-label="Commit history"]',
      );
      if (grid === null) throw new Error("Graph is not ready");
      const durations: number[] = [];
      const longTasks: number[] = [];
      let pending: number | undefined;
      let keyboardEvents = 0;
      let active = grid.getAttribute("aria-activedescendant");
      const mutations = new MutationObserver(() => {
        const next = grid.getAttribute("aria-activedescendant");
        if (pending !== undefined && next !== active) {
          durations.push(performance.now() - pending);
          pending = undefined;
        }
        active = next;
      });
      mutations.observe(grid, {
        attributes: true,
        attributeFilter: ["aria-activedescendant"],
      });
      const observer = new PerformanceObserver((entries) =>
        longTasks.push(...entries.getEntries().map(({ duration }) => duration)),
      );
      observer.observe({ type: "longtask" });
      const timer = setInterval(() => {
        if (pending !== undefined) return;
        pending = performance.now();
        const key = keyboardEvents % 100 < 50 ? "ArrowDown" : "ArrowUp";
        keyboardEvents += 1;
        grid.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, 16);
      const started = performance.now();
      try {
        const storage = await window.__storageMaintenance.run();
        clearInterval(timer);
        while (pending !== undefined && performance.now() - pending < 50)
          await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await new Promise((resolve) => setTimeout(resolve, 0));
        longTasks.push(
          ...observer.takeRecords().map(({ duration }) => duration),
        );
        return {
          storage,
          maintenanceMilliseconds: performance.now() - started,
          keyboardEvents,
          feedbackSamples: durations.length,
          maximumFeedbackMilliseconds: Math.max(0, ...durations),
          p95FeedbackMilliseconds: durations.toSorted((a, b) => a - b)[
            Math.ceil(durations.length * 0.95) - 1
          ],
          maximumLongTaskMilliseconds: Math.max(0, ...longTasks),
        };
      } finally {
        clearInterval(timer);
        mutations.disconnect();
        observer.disconnect();
      }
    });
    process.stdout.write(`${JSON.stringify(metrics)}\n`);
    await test.info().attach("history-storage-interaction.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    expect(metrics.storage.quotaTriggered).toBe(true);
    expect(metrics.storage.visible).toMatchObject({
      commitCount: 500,
      open: true,
      state: "complete",
    });
    expect(metrics.storage.rebuilt).toMatchObject({
      commitCount: 20_000,
      open: true,
      state: "complete",
    });
    expect(metrics.storage.pruned).toMatchObject({
      commitCount: 1,
      open: false,
      state: "complete",
    });
    expect(metrics.feedbackSamples).toBeGreaterThanOrEqual(5);
    expect(metrics.feedbackSamples).toBe(metrics.keyboardEvents);
    expect(metrics.maximumFeedbackMilliseconds).toBeLessThan(50);
    expect(metrics.maximumLongTaskMilliseconds).toBeLessThan(50);
  } finally {
    await page
      .evaluate(() => window.__storageMaintenance?.close())
      .catch(() => undefined);
    await server.close();
  }
});
