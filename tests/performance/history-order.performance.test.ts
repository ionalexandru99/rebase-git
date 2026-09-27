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
      const replicaPath =
        "/features/repository-history/worker/history-replica.ts";
      const {
        HistoryReplica,
      }: typeof import("#web/features/repository-history/worker/history-replica") =
        await import(replicaPath);
      const historyPath = "/features/repository-history/repository-history.ts";
      const {
        openRepositoryHistory,
      }: typeof import("#web/features/repository-history/repository-history") =
        await import(historyPath);
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
      const scope = (
        order: "topological" | "chronological",
        expanded: readonly { childOid: string; parentOid: string }[] = [],
      ) => ({ roots, order, expanded });
      let completed = false;
      const replica = new HistoryReplica(
        environmentId,
        repositoryId,
        (snapshot) => {
          completed = snapshot.synchronization === "complete";
        },
        () => true,
      );
      const socket: import("#web/platform/environment/environment-connection").EnvironmentSocket =
        {
          environmentId,
          synchronizeHistory: async (_request, accept) => {
            await accept({
              _tag: "RepositoryHistoryTips",
              objectFormat: "sha1",
              rootOids: [oid(0)],
              shallowOids: [],
              refTargets: roots,
            });
            for (let offset = 0; offset < count; offset += 500) {
              if (offset % 50_000 === 0)
                console.log(`history-order: storing ${offset}/${count}`);
              await accept({
                _tag: "RepositoryHistoryCommits",
                commits: Array.from(
                  { length: Math.min(500, count - offset) },
                  (_, index) => commit(index + offset),
                ),
              });
            }
          },
          closed: new Promise(() => {}),
        };
      const ingestStarted = performance.now();
      replica.synchronize({ socket, repositoryId });
      while (!completed) await new Promise(requestAnimationFrame);
      const ingestMilliseconds = performance.now() - ingestStarted;
      console.log(`history-order: synchronized in ${ingestMilliseconds}ms`);
      await replica.close();
      const indexStarted = performance.now();
      const reopened = new HistoryReplica(
        environmentId,
        repositoryId,
        () => {},
        () => true,
      );
      await reopened.rows(scope("topological"), 0, 100);
      const indexMilliseconds = performance.now() - indexStarted;
      console.log(`history-order: index prepared in ${indexMilliseconds}ms`);
      const reopenStarted = performance.now();
      const history = openRepositoryHistory({
        environmentId,
        repositoryId,
        logicalRepositoryId: repositoryId,
      });
      let freshWorkerGraphMilliseconds: number;
      try {
        const first = await history.ask({
          _tag: "Rows",
          scope: scope("topological"),
          start: 0,
          end: 100,
        });
        freshWorkerGraphMilliseconds = performance.now() - reopenStarted;
        if (first.rows.length !== 100)
          throw new Error("Fresh worker could not prepare the first graph");
      } finally {
        history.close();
      }
      const durations: number[] = [];
      for (let run = 0; run < 30; run += 1) {
        const started = performance.now();
        const result = await reopened.rows(
          scope(run % 2 === 0 ? "chronological" : "topological", [
            { childOid: oid(count - 1), parentOid: oid(run) },
          ]),
          100,
          200,
        );
        const duration = performance.now() - started;
        const expected = Array.from({ length: 300 }, (_, index) => index)
          .filter((index) => index % 4 !== 2)
          .slice(100, 200)
          .map(oid);
        if (
          result.rows.map(({ commit }) => commit.oid).join() !== expected.join()
        )
          throw new Error("Ordered page is inconsistent");
        durations.push(duration);
      }
      const expansionStarted = performance.now();
      const expanded = await reopened.rows(
        scope("topological", [{ childOid: oid(0), parentOid: oid(2) }]),
        0,
        100,
      );
      const firstExpansionMilliseconds = performance.now() - expansionStarted;
      if (!expanded.rows.some(({ commit }) => commit.oid === oid(2)))
        throw new Error("Expanded merge page is inconsistent");
      await reopened.close();
      return {
        ingestMilliseconds,
        indexMilliseconds,
        durations,
        firstExpansionMilliseconds,
        freshWorkerGraphMilliseconds,
      };
    });
    const durations = measurements.durations.toSorted((a, b) => a - b);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Infinity;
    process.stdout.write(
      `${JSON.stringify({ ...measurements, p95Milliseconds: p95 })}\n`,
    );
    assertTimingBudget("Cached history order p95", p95, 100);
    assertTimingBudget(
      "First graph from stored topology in a fresh worker",
      measurements.freshWorkerGraphMilliseconds,
      250,
    );
    assertTimingBudget(
      "First merge expansion with prepared history",
      measurements.firstExpansionMilliseconds,
      100,
    );
  } finally {
    await server.close();
  }
});
