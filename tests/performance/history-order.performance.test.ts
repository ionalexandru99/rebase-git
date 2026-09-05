import { resolve } from "node:path";
import { test } from "@playwright/test";
import { createServer } from "vite";
import { assertTimingBudget } from "#tests-performance/timing-budget";

test("cached order changes on 250,000 merge-heavy commits", async ({
  page,
}) => {
  test.setTimeout(600_000);
  page.on("console", (message) => {
    if (message.text().startsWith("history-order:"))
      process.stdout.write(`${message.text()}\n`);
  });
  const server = await createServer({
    configFile: resolve("src/apps/web/vite.config.ts"),
    root: resolve("src/apps/web"),
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  await server.listen();
  try {
    const url = server.resolvedUrls?.local[0];
    if (url === undefined) throw new Error("Performance server has no URL");
    await page.goto(url);
    const measurements = await page.evaluate(async () => {
      const storePath =
        "/features/repository-history/replica/repository-history-store.ts";
      const store: typeof import("#web/features/repository-history/replica/repository-history-store") =
        await import(storePath);
      const queryPath =
        "/features/repository-history/query/repository-history-query.ts";
      const queries: typeof import("#web/features/repository-history/query/repository-history-query") =
        await import(queryPath);
      const environmentId = crypto.randomUUID();
      const repositoryId = crypto.randomUUID();
      const count = 250_000;
      const oid = (index: number) => index.toString(16).padStart(40, "0");
      const roots = [{ name: "main", oid: oid(0), type: "branch" as const }];
      const parents = (index: number) => {
        if (index === count - 1) return [];
        if (index % 4 === 0) return [oid(index + 1), oid(index + 2)];
        return [oid(index + (index % 4 === 1 ? 2 : 1))];
      };
      const commit = (index: number) => ({
        oid: oid(index),
        parents: parents(index),
        subject: `Merge-heavy commit ${index}`,
        author: {
          email: "graph@example.test",
          name: "Graph benchmark",
          timestampSeconds: count - index,
          timezoneOffsetMinutes: 0,
        },
        committer: {
          email: "graph@example.test",
          name: "Graph benchmark",
          timestampSeconds: count - index + (index % 4 === 2 ? 2 : 0),
          timezoneOffsetMinutes: 0,
        },
      });
      await store.storeRepositoryHistoryPage(
        environmentId,
        repositoryId,
        {
          commits: Array.from({ length: 100 }, (_, index) => commit(index)),
          objectFormat: "sha1",
          refTargets: roots,
          repositoryId,
          requestId: crypto.randomUUID(),
        },
        { limit: 100, order: "topological", roots },
      );
      await store.beginRepositoryHistorySynchronization(
        environmentId,
        repositoryId,
      );
      for (let offset = 0; offset < count; offset += 1_000) {
        if (offset % 50_000 === 0)
          console.log(`history-order: storing ${offset}/${count}`);
        await store.storeRepositoryHistoryBatch(environmentId, repositoryId, {
          commits: Array.from(
            { length: Math.min(1_000, count - offset) },
            (_, index) => commit(index + offset),
          ),
          objectFormat: "sha1",
          repositoryId,
          requestId: crypto.randomUUID(),
          sequence: offset / 1_000,
        });
      }
      await store.completeStoredRepositoryHistory(
        environmentId,
        repositoryId,
        count,
      );
      console.log("history-order: preparing compact index");
      const cache: import("#web/features/repository-history/query/history-order.contract").HistoryOrderCache =
        { queries: new Map(), revision: 0 };
      const indexStarted = performance.now();
      await queries.prepareRepositoryHistoryOrder(
        environmentId,
        repositoryId,
        cache,
      );
      const indexMilliseconds = performance.now() - indexStarted;
      console.log(`history-order: index prepared in ${indexMilliseconds}ms`);
      const durations: number[] = [];
      for (let run = 0; run < 30; run += 1) {
        cache.queries.clear();
        const started = performance.now();
        const result = await queries.readRepositoryHistory(
          environmentId,
          repositoryId,
          {
            limit: 100,
            offset: 100,
            order: run % 2 === 0 ? "chronological" : "topological",
            roots,
          },
          indexedDB,
          cache,
        );
        const duration = performance.now() - started;
        if (
          result?.length !== 100 ||
          result.some((commit, position) => {
            const chronologicalOffset =
              run % 2 === 0
                ? position % 4 === 1
                  ? 1
                  : position % 4 === 2
                    ? -1
                    : 0
                : 0;
            return commit.oid !== oid(100 + position + chronologicalOffset);
          })
        )
          throw new Error("Ordered page is inconsistent");
        durations.push(duration);
      }
      return { indexMilliseconds, durations };
    });
    const durations = measurements.durations.toSorted((a, b) => a - b);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Infinity;
    process.stdout.write(
      `${JSON.stringify({ ...measurements, p95Milliseconds: p95 })}\n`,
    );
    assertTimingBudget("Cached history order p95", p95, 100);
  } finally {
    await server.close();
  }
});
