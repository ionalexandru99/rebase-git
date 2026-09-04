import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createServer } from "vite";
import type { CommitGraphPageWindow } from "#web/features/commit-graph/paging/commit-graph-page-window.contract";

test("the renderer's initial 16-page cache stays below 64 MiB of retained JavaScript heap", async ({
  page,
}) => {
  const server = await createServer({
    configFile: resolve("src/apps/web/vite.config.ts"),
    root: resolve("src/apps/web"),
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  server.middlewares.use("/__history_heap__", (_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      "<!doctype html><title>History cache heap measurement</title>",
    );
  });
  await server.listen();
  const session = await page.context().newCDPSession(page);
  try {
    const url = server.resolvedUrls?.local[0];
    if (url === undefined) throw new Error("Performance server has no URL");
    await page.goto(`${url}__history_heap__`);
    await page.evaluate(async () => {
      const modulePath =
        "/features/commit-graph/paging/commit-graph-page-window.ts";
      const {
        createCommitGraphPageWindow,
      }: typeof import("#web/features/commit-graph/paging/commit-graph-page-window") =
        await import(modulePath);
      const branches = 256;
      const totalCommits = branches * 16 + 2;
      const oid = (index: number) => index.toString(16).padStart(40, "0");
      const reader: import("#web/features/commit-graph/paging/commit-graph-page-window.contract").CommitGraphPageReader =
        {
          ancestryRoute: async () => undefined,
          locate: async () => undefined,
          locateMany: async () => [],
          read: async (query) =>
            structuredClone(
              Array.from(
                {
                  length: Math.min(
                    query.limit,
                    totalCommits - (query.offset ?? 0),
                  ),
                },
                (_, offset) => {
                  const index = (query.offset ?? 0) + offset;
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
                        ? Array.from({ length: branches }, (_, branch) =>
                            oid(branch + 1),
                          )
                        : index === totalCommits - 1
                          ? []
                          : [oid(Math.min(index + branches, totalCommits - 1))],
                    subject: `${index} ${"History metadata π ".repeat(32)}`,
                    author: identity("Author"),
                    committer: identity("Committer"),
                  };
                },
              ),
            ),
        };
      window.__loadHistoryHeapCache = async () => {
        const cache = createCommitGraphPageWindow(reader);
        window.__historyHeapCache = cache;
        await cache.loadInitial({
          limit: 100,
          order: "topological",
          ancestry: "all",
          roots: [{ name: "main", oid: oid(0), type: "branch" }],
        });
        for (let pageIndex = 1; pageIndex < 16; pageIndex += 1)
          await cache.appendOlder();
      };
    });
    await session.send("HeapProfiler.enable");
    await session.send("HeapProfiler.collectGarbage");
    const before = await session.send("Runtime.getHeapUsage");
    await page.evaluate(() => window.__loadHistoryHeapCache());
    await session.send("HeapProfiler.collectGarbage");
    const after = await session.send("Runtime.getHeapUsage");
    const cache = await page.evaluate(() => {
      const snapshot = window.__historyHeapCache.getSnapshot();
      return {
        residentPages: snapshot.pages.length,
        residentCommits: snapshot.pages.reduce(
          (count, retained) => count + retained.commits.length,
          0,
        ),
        commitsPerPage: snapshot.pages.map(
          (retained) => retained.commits.length,
        ),
        activeLanesPerCheckpoint: snapshot.pages.map(
          (retained) => retained.outgoingCheckpoint.lanes.length,
        ),
        checkpointCount: snapshot.checkpointCount,
        estimatedBytes: snapshot.estimatedBytes,
        error: snapshot.error,
      };
    });
    const metrics = {
      ...cache,
      beforeUsedBytes: before.usedSize,
      afterUsedBytes: after.usedSize,
      retainedHeapBytes: after.usedSize - before.usedSize,
      budgetBytes: 64 * 1_048_576,
      scope:
        "Renderer initial page cache, metadata and lane checkpoints; excludes the complete SharedWorker replica",
    };
    process.stdout.write(`${JSON.stringify(metrics)}\n`);
    await test.info().attach("initial-graph-cache-heap.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    expect(cache.error).toBeUndefined();
    expect(cache.residentPages).toBe(16);
    expect(cache.residentCommits).toBe(1_600);
    expect(cache.commitsPerPage).toEqual(Array(16).fill(100));
    expect(cache.activeLanesPerCheckpoint).toEqual(Array(16).fill(256));
    expect(cache.checkpointCount).toBe(17);
    expect(metrics.retainedHeapBytes).toBeGreaterThan(0);
    expect(metrics.retainedHeapBytes).toBeLessThanOrEqual(metrics.budgetBytes);
  } finally {
    await session.detach();
    await server.close();
  }
});

declare global {
  interface Window {
    __historyHeapCache: CommitGraphPageWindow;
    __loadHistoryHeapCache: () => Promise<void>;
  }
}
