import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createServer } from "vite";

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`DPR ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });
    test("scrolls the production graph with bounded tiles and aligned pixels", async ({
      page,
    }) => {
      test.skip(Boolean(process.env.CI), "Local performance benchmark");
      const server = await createServer({
        configFile: resolve("src/apps/web/vite.config.ts"),
        root: resolve("."),
        resolve: {
          alias: {
            "#web": resolve("src/apps/web"),
            "#web-ui": resolve("src/apps/web"),
          },
        },
        server: { host: "127.0.0.1", port: 0, hmr: false },
        plugins: [
          {
            name: "graph-scroll-benchmark",
            configureServer(server) {
              server.middlewares.use(
                "/__graph_scroll__",
                async (_request, response) => {
                  response.setHeader("Content-Type", "text/html");
                  response.end(
                    await server.transformIndexHtml(
                      "/__graph_scroll__",
                      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Graph scroll benchmark</title><body><script type="module">import "/src/apps/web/styles.css";</script></body></html>',
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
        const baseUrl = server.resolvedUrls?.local[0];
        if (baseUrl === undefined)
          throw new Error("Benchmark server has no URL");
        await page.goto(`${baseUrl}__graph_scroll__`);
        const results = [];
        for (const laneCount of [4, 32, 128]) {
          await page.evaluate(async (laneCount) => {
            const path = "/tests/performance/fixtures/graph-scroll.browser.ts";
            const fixture: typeof import("#tests-performance/fixtures/graph-scroll.browser") =
              await import(path);
            fixture.mountGraph(laneCount);
          }, laneCount);
          await expect(page.locator("tr[aria-rowindex]").first()).toBeVisible();
          await page.screenshot({
            path: test.info().outputPath(`graph-${laneCount}-lanes.png`),
          });
          const result = await page.evaluate(async (laneCount) => {
            const path = "/tests/performance/fixtures/graph-scroll.browser.ts";
            const fixture: typeof import("#tests-performance/fixtures/graph-scroll.browser") =
              await import(path);
            return fixture.measureGraphScroll(laneCount);
          }, laneCount);
          expect(result.maximumMismatch).toBe(0);
          expect(result.paintedSamples).toBe(160);
          expect(result.maximumRows).toBeLessThan(60);
          expect(result.maximumTiles).toBeLessThanOrEqual(4);
          expect(result.maximumBytes).toBeLessThanOrEqual(64 * 1_048_576);
          expect(result.draws).toBeLessThan(40);
          expect(result.p95FrameMilliseconds).toBeLessThan(50);
          results.push(result);
        }
        await page.screenshot({ path: test.info().outputPath("graph.png") });
        await test.info().attach("graph-scroll-results.json", {
          body: JSON.stringify(results, null, 2),
          contentType: "application/json",
        });
        process.stdout.write(`${JSON.stringify(results)}\n`);
      } finally {
        await server.close();
      }
    });
  });
}
