import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  gitHistoryFormat,
  parseGitHistory,
} from "@rebase/server/features/repository-history/git/parse-git-history";
import { createServer } from "vite";

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
  });
  await server.listen();
  try {
    const url = server.resolvedUrls?.local[0];
    if (url === undefined) throw new Error("Performance server has no URL");
    await page.goto(url);
    const fixture = { repositoryCommits: actualCommits, onlyRepository };
    const measurements = await page.evaluate(async (fixture) => {
      const { repositoryCommits, onlyRepository } = fixture;
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
          count: repositoryCommits.length,
          commit: (index: number) =>
            repositoryCommits[index] ?? generatedCommit(index),
          queries: ["graph", "history", "missing-token-no-match"],
        },
        {
          name: "generated",
          count,
          commit: generatedCommit,
          queries: ["history", "developer7", "synchronization 249999"],
        },
      ].filter((corpus) => !onlyRepository || corpus.name === "repository");
      const measurements = [];
      for (const corpus of corpora) {
        const repositoryId = crypto.randomUUID();
        const roots = [
          {
            name: "main",
            oid: corpus.commit(0).oid,
            type: "branch" as const,
          },
        ];
        const seedStarted = performance.now();
        await store.storeRepositoryHistoryPage(
          environmentId,
          repositoryId,
          {
            commits: Array.from(
              { length: Math.min(100, corpus.count) },
              (_, index) => corpus.commit(index),
            ),
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
            commits: Array.from(
              { length: Math.min(1_000, corpus.count - offset) },
              (_, index) => corpus.commit(offset + index),
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
          console.log(
            `history-search: ${JSON.stringify({ corpus: corpus.name, cancellationMilliseconds: performance.now() - canceledAt })}`,
          );
        } finally {
          clearTimeout(timer);
        }
      }
      return measurements;
    }, fixture);
    expect(measurements).toHaveLength(onlyRepository ? 3 : 6);
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
