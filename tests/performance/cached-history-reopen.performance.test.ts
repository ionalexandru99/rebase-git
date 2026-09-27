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
      const databasePath = "/features/repository-history/history-database.ts";
      const database: typeof import("#web/features/repository-history/history-database") =
        await import(databasePath);
      const historyPath = "/features/repository-history/repository-history.ts";
      const {
        openRepositoryHistory,
      }: typeof import("#web/features/repository-history/repository-history") =
        await import(historyPath);
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
      const record = await database.openRepository(environmentId, repositoryId);
      const stored = { ...record, commitCount: 100, minimumEpoch: -1 };
      await database.storeCommits(
        stored,
        commits.map((commit, order) => ({ commit, epoch: -1, order })),
      );
      await database.updateRepository({
        ...stored,
        tips: {
          _tag: "RepositoryHistoryTips",
          objectFormat: "sha1",
          rootOids: [oid(0)],
          shallowOids: [],
          refTargets: roots,
        },
      });
      const scope = { roots, order: "topological" as const, expanded: [] };
      const identity = {
        environmentId,
        repositoryId,
        logicalRepositoryId: repositoryId,
      };
      const first = openRepositoryHistory(identity);
      await first.ask({ _tag: "Rows", scope, start: 0, end: 100 });
      first.close();
      const durations: number[] = [];
      for (let run = 0; run < 30; run += 1) {
        const started = performance.now();
        const history = openRepositoryHistory(identity);
        try {
          const cached = await history.ask({
            _tag: "Rows",
            scope,
            start: 0,
            end: 100,
          });
          durations.push(performance.now() - started);
          if (
            cached.rows.length !== 100 ||
            cached.rows.some(({ commit }, index) => commit.oid !== oid(index))
          )
            throw new Error(
              "Reopened history does not match the completed cache",
            );
        } finally {
          history.close();
        }
      }
      const ordered = durations.toSorted((left, right) => left - right);
      return {
        durations,
        p95Milliseconds: ordered[Math.ceil(ordered.length * 0.95) - 1],
        maximumMilliseconds: Math.max(...durations),
        networkPageRequests: 0,
        scope:
          "30 new history ports to completed IndexedDB history after worker module initialization",
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
