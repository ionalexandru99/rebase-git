import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createServer } from "vite";
import { assertTimingBudget } from "#tests-performance/timing-budget";

test("completed offline history reopens within its timing budget", async ({
  page,
}) => {
  const server = await createServer({
    configFile: resolve("src/apps/web/vite.config.ts"),
    root: resolve("src/apps/web"),
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  server.middlewares.use("/__history_reopen__", (_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      "<!doctype html><title>Cached history reopen measurement</title>",
    );
  });
  await server.listen();
  try {
    const url = server.resolvedUrls?.local[0];
    if (url === undefined) throw new Error("Performance server has no URL");
    await page.goto(`${url}__history_reopen__`);
    const metrics = await page.evaluate(async () => {
      const storePath =
        "/features/repository-history/replica/repository-history-store.ts";
      const store: typeof import("#web/features/repository-history/replica/repository-history-store") =
        await import(storePath);
      const readerPath =
        "/features/repository-history/browser-repository-history-reader.ts";
      const {
        createBrowserRepositoryHistoryReader,
      }: typeof import("#web/features/repository-history/browser-repository-history-reader") =
        await import(readerPath);
      const contractPath =
        "/features/repository-history/repository-history-reader.contract.ts";
      const {
        RepositoryHistoryOffline,
      }: typeof import("#web/features/repository-history/repository-history-reader.contract") =
        await import(contractPath);
      const environmentId = crypto.randomUUID();
      const repositoryId = crypto.randomUUID();
      const oid = (index: number) => index.toString(16).padStart(40, "0");
      const commits = Array.from({ length: 100 }, (_, index) => {
        const identity = {
          name: "History benchmark",
          email: "history@example.test",
          timestampSeconds: 1_777_777_777 - index,
          timezoneOffsetMinutes: 0,
        };
        return {
          oid: oid(index),
          parents: index === 99 ? [] : [oid(index + 1)],
          subject: `Cached commit ${index}`,
          author: identity,
          committer: identity,
        };
      });
      const roots = [{ name: "main", oid: oid(0), type: "branch" as const }];
      const query = { limit: 100, order: "topological" as const, roots };
      await store.storeRepositoryHistoryPage(
        environmentId,
        repositoryId,
        {
          commits,
          objectFormat: "sha1",
          refTargets: roots,
          repositoryId,
          requestId: crypto.randomUUID(),
        },
        query,
      );
      await store.beginRepositoryHistorySynchronization(
        environmentId,
        repositoryId,
      );
      await store.storeRepositoryHistoryBatch(environmentId, repositoryId, {
        commits,
        objectFormat: "sha1",
        repositoryId,
        requestId: crypto.randomUUID(),
        sequence: 0,
      });
      await store.completeStoredRepositoryHistory(
        environmentId,
        repositoryId,
        commits.length,
      );
      let networkPageRequests = 0;
      const gateway: import("#web/features/repository-history/repository-history-reader.contract").RepositoryHistoryGateway =
        {
          read: async () => {
            networkPageRequests += 1;
            throw new RepositoryHistoryOffline();
          },
          synchronize: async () => {
            throw new RepositoryHistoryOffline();
          },
        };
      const first = createBrowserRepositoryHistoryReader({
        environmentId,
        repositoryId,
        gateway,
      });
      await first.read(query);
      first.close();
      const durations: number[] = [];
      for (let run = 0; run < 30; run += 1) {
        const started = performance.now();
        const reader = createBrowserRepositoryHistoryReader({
          environmentId,
          repositoryId,
          gateway,
        });
        try {
          const cached = await reader.read(query);
          durations.push(performance.now() - started);
          if (
            cached.length !== 100 ||
            cached.some((commit, index) => commit.oid !== oid(index))
          )
            throw new Error(
              "Reopened history does not match the completed cache",
            );
        } finally {
          reader.close();
        }
      }
      const ordered = durations.toSorted((left, right) => left - right);
      return {
        durations,
        p95Milliseconds: ordered[Math.ceil(ordered.length * 0.95) - 1],
        maximumMilliseconds: Math.max(...durations),
        networkPageRequests,
        scope:
          "30 new reader connections to completed IndexedDB history after worker module initialization",
      };
    });
    process.stdout.write(`${JSON.stringify(metrics)}\n`);
    await test.info().attach("cached-history-reopen.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    expect(metrics.networkPageRequests).toBe(0);
    expect(metrics.durations).toHaveLength(30);
    assertTimingBudget(
      "Cached history reopen maximum",
      metrics.maximumMilliseconds,
      100,
    );
  } finally {
    await server.close();
  }
});
