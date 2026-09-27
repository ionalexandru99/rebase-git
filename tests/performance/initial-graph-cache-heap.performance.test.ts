import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createServer } from "vite";

test("the history view for the first 1,600 rows of 256 active lanes stays below 64 MiB of retained JavaScript heap", async ({
  page,
}) => {
  const server = await createServer({
    configFile: resolve("src/apps/web/vite.config.ts"),
    root: resolve("src/apps/web"),
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  server.middlewares.use("/__history_heap__", (_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><title>History view heap measurement</title>");
  });
  await server.listen();
  const session = await page.context().newCDPSession(page);
  try {
    const url = server.resolvedUrls?.local[0];
    if (url === undefined) throw new Error("Performance server has no URL");
    await page.goto(`${url}__history_heap__`);
    await page.evaluate(async () => {
      const graphPath = "/features/repository-history/history-graph.ts";
      const {
        HistoryGraph,
      }: typeof import("#web/features/repository-history/history-graph.ts") =
        await import(graphPath);
      const viewPath = "/features/repository-history/history-view.ts";
      const {
        HistoryView,
      }: typeof import("#web/features/repository-history/history-view.ts") =
        await import(viewPath);
      const branches = 256;
      const totalCommits = branches * 16 + 2;
      const oid = (index: number) => index.toString(16).padStart(40, "0");
      const commit = (index: number) => {
        const identity = (role: string) => ({
          name: `${role} ${index} ${"n".repeat(48)}`,
          email: `${role.toLowerCase()}-${index}@history-metadata.example.test`,
          timestampSeconds: 1_777_777_777 - index,
          timezoneOffsetMinutes: 120,
        });
        return {
          oid: oid(index),
          parents:
            index === 0
              ? Array.from({ length: branches }, (_, branch) => oid(branch + 1))
              : index === totalCommits - 1
                ? []
                : [oid(Math.min(index + branches, totalCommits - 1))],
          subject: `${index} ${"History metadata π ".repeat(32)}`,
          author: identity("Author"),
          committer: identity("Committer"),
        };
      };
      window.__loadHistoryHeapView = () => {
        const graph = new HistoryGraph();
        for (let index = 0; index < totalCommits; index += 1)
          graph.add(commit(index), index);
        const view = new HistoryView(
          graph,
          {
            roots: [{ name: "main", oid: oid(0), type: "branch" }],
            order: "topological",
            expanded: Array.from({ length: branches - 1 }, (_, branch) => ({
              childOid: oid(0),
              parentOid: oid(branch + 2),
            })),
          },
          [],
        );
        const rows = view.rows(0, 1_600);
        window.__historyHeapView = { graph, view, rows };
        return {
          rows: rows.length,
          lanes: Math.max(...rows.map(({ lane }) => lane.lanesAfter.length)),
        };
      };
    });
    await session.send("HeapProfiler.enable");
    await session.send("HeapProfiler.collectGarbage");
    const before = await session.send("Runtime.getHeapUsage");
    const view = await page.evaluate(() => window.__loadHistoryHeapView());
    await session.send("HeapProfiler.collectGarbage");
    const after = await session.send("Runtime.getHeapUsage");
    const metrics = {
      ...view,
      beforeUsedBytes: before.usedSize,
      afterUsedBytes: after.usedSize,
      retainedHeapBytes: after.usedSize - before.usedSize,
      budgetBytes: 64 * 1_048_576,
      scope:
        "Worker history graph and scope view with lane rows for the first 1,600 rows",
    };
    process.stdout.write(`${JSON.stringify(metrics)}\n`);
    await test.info().attach("initial-graph-cache-heap.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    expect(view.rows).toBe(1_600);
    expect(view.lanes).toBe(256);
    expect(metrics.retainedHeapBytes).toBeGreaterThan(0);
    expect(metrics.retainedHeapBytes).toBeLessThanOrEqual(metrics.budgetBytes);
  } finally {
    await session.detach();
    await server.close();
  }
});

declare global {
  interface Window {
    __historyHeapView: unknown;
    __loadHistoryHeapView: () => { rows: number; lanes: number };
  }
}
