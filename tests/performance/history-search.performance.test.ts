import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import type { RepositoryCommit } from "@rebase/contracts";
import {
  gitHistoryFormat,
  parseGitHistory,
} from "@rebase/server/features/repository-history/git/parse-git-history";
import { createServer } from "vite";
import { assertTimingBudget } from "#tests-performance/timing-budget";

test("cached metadata search on repository history and 250,000 merge-heavy commits", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const onlyRepository = process.env.HISTORY_SEARCH_ONLY_REPOSITORY === "1";
  const { stdout } = await promisify(execFile)(
    "git",
    ["log", "--all", `--format=${gitHistoryFormat}`, "-z"],
    {
      maxBuffer: 256 * 1_048_576,
      ...(process.env.HISTORY_SEARCH_REPOSITORY_PATH === undefined
        ? {}
        : { cwd: process.env.HISTORY_SEARCH_REPOSITORY_PATH }),
    },
  );
  const actualCommits = parseGitHistory(stdout, "sha1");
  page.on("console", (message) => {
    if (message.text().startsWith("history-search:"))
      process.stdout.write(`${message.text()}\n`);
  });
  const server = await createServer({
    configFile: resolve("src/apps/web/vite.config.ts"),
    root: resolve("src/apps/web"),
    server: { host: "127.0.0.1", port: 0, hmr: false },
    plugins: [
      {
        name: "history-search-corpus",
        configureServer(server) {
          server.middlewares.use(
            "/__history-search-corpus",
            (request, response) => {
              const query = new URL(request.url ?? "", "http://localhost")
                .searchParams;
              const offset = Number(query.get("offset"));
              const limit = Number(query.get("limit"));
              if (
                !Number.isInteger(offset) ||
                offset < 0 ||
                !Number.isInteger(limit) ||
                limit < 1 ||
                limit > 1_000
              ) {
                response.statusCode = 400;
                response.end();
                return;
              }
              response.setHeader("Content-Type", "application/json");
              response.end(
                JSON.stringify(actualCommits.slice(offset, offset + limit)),
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
    await page.goto(url);
    const fixture = {
      repositoryCommitCount: actualCommits.length,
      onlyRepository,
    };
    const measurements = await page.evaluate(async (fixture) => {
      const { repositoryCommitCount, onlyRepository } = fixture;
      const storePath =
        "/features/repository-history/repository-history-store.ts";
      const store: typeof import("#web/features/repository-history/repository-history-store") =
        await import(storePath);
      const searchPath =
        "/features/repository-history/search/repository-history-search.ts";
      const {
        searchStoredRepositoryHistory,
      }: typeof import("#web/features/repository-history/search/repository-history-search") =
        await import(searchPath);
      const environmentId = crypto.randomUUID();
      const count = 250_000;
      const oid = (index: number) => index.toString(16).padStart(40, "0");
      const generatedCommit = (index: number) => {
        const identity = {
          email: `developer${index % 16}@example.test`,
          name: `Developer ${index % 16}`,
          timestampSeconds: count - index,
          timezoneOffsetMinutes: 0,
        };
        return {
          oid: oid(index),
          parents:
            index === count - 1
              ? []
              : index % 4 === 0
                ? [oid(index + 1), oid(index + 2)]
                : [oid(index + (index % 4 === 1 ? 2 : 1))],
          subject: `${index % 5 === 0 ? "Merge" : "Fix"} history synchronization ${index}`,
          author: identity,
          committer: {
            ...identity,
            timestampSeconds:
              identity.timestampSeconds + (index % 4 === 2 ? 2 : 0),
          },
        };
      };
      const corpora = [
        {
          name: "repository",
          count: repositoryCommitCount,
          read: async (
            offset: number,
            limit: number,
          ): Promise<RepositoryCommit[]> => {
            const response = await fetch(
              `/__history-search-corpus?offset=${offset}&limit=${limit}`,
            );
            if (!response.ok)
              throw new Error("Failed to load repository fixture");
            return response.json();
          },
          queries: ["graph", "history", "missing-token-no-match"],
        },
        {
          name: "generated",
          count,
          read: async (offset: number, limit: number) =>
            Array.from(
              { length: Math.min(limit, count - offset) },
              (_, index) => generatedCommit(offset + index),
            ),
          queries: ["history", "developer7", "synchronization 249999"],
        },
      ].filter((corpus) => !onlyRepository || corpus.name === "repository");
      const measurements = [];
      for (const corpus of corpora) {
        const repositoryId = crypto.randomUUID();
        const firstPage = await corpus.read(0, 100);
        const head = firstPage[0];
        if (head === undefined) throw new Error("Repository fixture is empty");
        const roots = [
          {
            name: "main",
            oid: head.oid,
            type: "branch" as const,
          },
        ];
        const seedStarted = performance.now();
        await store.storeRepositoryHistoryPage(
          environmentId,
          repositoryId,
          {
            commits: firstPage,
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
        for (let offset = 0; offset < corpus.count; offset += 1_000) {
          if (offset % 50_000 === 0)
            console.log(
              `history-search: storing ${corpus.name} ${offset}/${corpus.count}`,
            );
          await store.storeRepositoryHistoryBatch(environmentId, repositoryId, {
            commits: await corpus.read(offset, 1_000),
            objectFormat: "sha1",
            repositoryId,
            requestId: crypto.randomUUID(),
            sequence: offset / 1_000,
          });
        }
        await store.completeStoredRepositoryHistory(
          environmentId,
          repositoryId,
          corpus.count,
        );
        const seedMilliseconds = performance.now() - seedStarted;
        for (const text of corpus.queries) {
          const measureUntilMatch = async () => {
            let cursor: string | undefined;
            let scans = 0;
            let matches = 0;
            let maximumRequestMilliseconds = 0;
            let maximumEventLoopDelayMilliseconds = 0;
            let previousTick = performance.now();
            const heartbeat = setInterval(() => {
              const now = performance.now();
              maximumEventLoopDelayMilliseconds = Math.max(
                maximumEventLoopDelayMilliseconds,
                now - previousTick - 4,
              );
              previousTick = now;
            }, 4);
            const longTasks: number[] = [];
            const observer = new PerformanceObserver((entries) =>
              longTasks.push(
                ...entries.getEntries().map(({ duration }) => duration),
              ),
            );
            observer.observe({ type: "longtask" });
            const fullStarted = performance.now();
            do {
              const started = performance.now();
              const result = await searchStoredRepositoryHistory(
                environmentId,
                repositoryId,
                {
                  text,
                  limit: 20,
                  ...(cursor === undefined ? {} : { cursor }),
                },
              );
              maximumRequestMilliseconds = Math.max(
                maximumRequestMilliseconds,
                performance.now() - started,
              );
              cursor = result.nextCursor;
              scans += 1;
              matches += result.commits.length;
            } while (cursor !== undefined && matches === 0);
            const fullMilliseconds = performance.now() - fullStarted;
            await new Promise((resolve) => setTimeout(resolve, 0));
            clearInterval(heartbeat);
            longTasks.push(
              ...observer.takeRecords().map(({ duration }) => duration),
            );
            observer.disconnect();
            return {
              fullMilliseconds,
              maximumRequestMilliseconds,
              maximumEventLoopDelayMilliseconds,
              maximumLongTaskMilliseconds: Math.max(0, ...longTasks),
              scans,
              matches,
            };
          };
          const cold = await measureUntilMatch();
          const durations = [];
          let firstMatches = 0;
          for (let run = 0; run < 30; run += 1) {
            const started = performance.now();
            const result = await searchStoredRepositoryHistory(
              environmentId,
              repositoryId,
              { text, limit: 20 },
            );
            durations.push(performance.now() - started);
            firstMatches = result.commits.length;
          }
          const warm = await measureUntilMatch();
          const sorted = durations.toSorted((left, right) => left - right);
          const measurement = {
            corpus: corpus.name,
            count: corpus.count,
            text,
            seedMilliseconds,
            firstMatches,
            firstPageP50Milliseconds: sorted[14],
            firstPageP95Milliseconds: sorted[28],
            firstPageMaximumMilliseconds: Math.max(...durations),
            cold,
            warm,
            matches: warm.matches,
          };
          measurements.push(measurement);
          console.log(`history-search: ${JSON.stringify(measurement)}`);
        }
        const controller = new AbortController();
        let canceledAt = 0;
        const timer = setTimeout(() => {
          canceledAt = performance.now();
          controller.abort();
        }, 10);
        let cursor: string | undefined;
        let canceled = false;
        try {
          do {
            const result = await searchStoredRepositoryHistory(
              environmentId,
              repositoryId,
              {
                text: "unmatched-cancellation-needle",
                limit: 20,
                ...(cursor === undefined ? {} : { cursor }),
              },
              controller.signal,
            );
            cursor = result.nextCursor;
          } while (cursor !== undefined);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError"))
            throw error;
          if (canceledAt === 0 || !controller.signal.aborted)
            throw new Error(
              "Search aborted before the cancellation timer fired",
            );
          canceled = true;
          console.log(
            `history-search: ${JSON.stringify({ corpus: corpus.name, cancellationMilliseconds: performance.now() - canceledAt })}`,
          );
        } finally {
          clearTimeout(timer);
        }
        if (controller.signal.aborted && !canceled)
          throw new Error("Canceled search did not reject");
        if (!canceled) {
          if (corpus.name === "generated")
            throw new Error(
              "The large-corpus benchmark did not exercise cancellation",
            );
          console.log(
            `history-search: ${JSON.stringify({ corpus: corpus.name, completedBeforeCancellation: true })}`,
          );
        }
      }
      return measurements;
    }, fixture);
    expect(measurements).toHaveLength(onlyRepository ? 3 : 6);
    for (const measurement of measurements)
      assertTimingBudget(
        `History search first-page maximum (${measurement.corpus}, ${measurement.text})`,
        measurement.firstPageMaximumMilliseconds,
        250,
      );
    if (!onlyRepository)
      expect(
        measurements.find(
          (measurement) => measurement.text === "synchronization 249999",
        ),
      ).toMatchObject({ count: 250_000, firstMatches: 0, matches: 1 });
  } finally {
    await server.close();
  }
});
