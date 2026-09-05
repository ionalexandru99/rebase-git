import type {
  RepositoryCatalogEntry,
  RepositoryFreshness,
} from "@rebase/contracts";
import type { GitCommandRunner } from "@rebase/server/domain/git-command.contract";
import type { RepositoryCatalog } from "@rebase/server/domain/repository-catalog.contract";
import type { RepositoryFreshnessService } from "@rebase/server/domain/repository-freshness.contract";
import { acquireRepositoryFreshnessService } from "@rebase/server/features/repository-history/freshness/repository-freshness";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const linkedId = "00000000-0000-4000-8000-000000000002";

afterEach(() => vi.useRealTimers());

describe("repository freshness", () => {
  it("clears a defective manual fetch so it can be retried with automatic fetch disabled", async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(() =>
        Effect.die(new Error("Unexpected runner defect")),
      )
      .mockImplementation(() => Effect.succeed(output()));
    const states: RepositoryFreshness[] = [];
    await withService({ fetch, setting: "0" }, async (service) => {
      await Effect.runPromise(
        service.subscribe(repositoryId, (state) => states.push(state)),
      );
      expect(
        await Effect.runPromise(service.fetch(repositoryId)),
      ).toMatchObject({
        fetching: false,
        stale: true,
        failure: { _tag: "FetchFailed" },
      });
      expect(states.at(-1)?.fetching).toBe(false);
      expect(
        await Effect.runPromise(service.fetch(repositoryId)),
      ).toMatchObject({ fetching: false, stale: false });
    });
  });

  it("fetches through a surviving worktree after the original subscriber leaves", async () => {
    let removed = false;
    const fetch = vi.fn((command: Parameters<GitCommandRunner["run"]>[0]) =>
      Effect.succeed(output(removed && command.directory === "/repo" ? 1 : 0)),
    );
    await withService({ fetch, setting: "0" }, async (service) => {
      const closeFirst = await Effect.runPromise(
        service.subscribe(repositoryId, () => {}),
      );
      await Effect.runPromise(service.subscribe(linkedId, () => {}));
      closeFirst();
      removed = true;
      expect(await Effect.runPromise(service.fetch(linkedId))).toMatchObject({
        stale: false,
        fetching: false,
      });
      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({ directory: "/linked" }),
      );
    });
  });

  it("shares an immediate fetch across linked worktrees, subscriptions and manual requests", async () => {
    let finish: (() => void) | undefined;
    const fetch = vi.fn(() =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ).pipe(Effect.as(output())),
    );
    const states: RepositoryFreshness[] = [];
    await withService({ fetch }, async (service, watch) => {
      const [closeFirst, closeSecond] = await Promise.all([
        Effect.runPromise(
          service.subscribe(repositoryId, (state) => states.push(state)),
        ),
        Effect.runPromise(service.subscribe(linkedId, () => {})),
      ]);
      const manual = Effect.runPromise(service.fetch(linkedId));
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(states.at(-1)?.fetching).toBe(true);
      expect(watch.close).not.toHaveBeenCalled();
      finish?.();
      expect(await manual).toMatchObject({ fetching: false, stale: false });
      closeFirst();
      expect(watch.close).not.toHaveBeenCalled();
      closeSecond();
      expect(watch.close).toHaveBeenCalledTimes(1);
    });
  });

  it("retries failed fetches on the next interval and resets that interval after manual completion", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => Effect.succeed(output(1)))
      .mockImplementation(() => Effect.succeed(output()));
    const states: RepositoryFreshness[] = [];
    await withService({ fetch, setting: "0" }, async (service) => {
      await Effect.runPromise(
        service.subscribe(repositoryId, (state) => states.push(state)),
      );
      expect(fetch).not.toHaveBeenCalled();
      await Effect.runPromise(
        service.configure(repositoryId, { _tag: "Interval", seconds: 10 }),
      );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(states.at(-1)).toMatchObject({
        fetching: false,
        stale: true,
        failure: { _tag: "FetchFailed" },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(states.at(-1)).toMatchObject({ fetching: false, stale: false });
      expect(states.at(-1)?.failure).toBeUndefined();
      await vi.advanceTimersByTimeAsync(9_000);
      await Effect.runPromise(service.fetch(repositoryId));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetch).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(9_000);
      expect(fetch).toHaveBeenCalledTimes(4);
      await Effect.runPromise(
        service.configure(repositoryId, { _tag: "Disabled" }),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetch).toHaveBeenCalledTimes(4);
    });
  });

  it("publishes local changes independently of automatic fetch and releases the last subscription", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => Effect.succeed(output()));
    const states: RepositoryFreshness[] = [];
    await withService({ fetch, setting: "0" }, async (service, watch) => {
      const close = await Effect.runPromise(
        service.subscribe(repositoryId, (state) => states.push(state)),
      );
      watch.change();
      watch.change();
      await vi.advanceTimersByTimeAsync(50);
      expect(states.at(-1)?.revision).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
      close();
      watch.change();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(states).toHaveLength(2);
      expect(watch.close).toHaveBeenCalledOnce();
    });
  });

  it("cancels an in-flight fetch when the final browser leaves", async () => {
    const aborted = vi.fn();
    const fetch = vi.fn(() =>
      Effect.promise<void>(
        (signal) =>
          new Promise(() => {
            signal.addEventListener("abort", aborted);
          }),
      ).pipe(Effect.as(output())),
    );
    await withService({ fetch }, async (service) => {
      const close = await Effect.runPromise(
        service.subscribe(repositoryId, () => {}),
      );
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      close();
      await vi.waitFor(() => expect(aborted).toHaveBeenCalledOnce());
    });
  });
});

function output(exitCode = 0, stdout = "") {
  return { exitCode, stdout, stderr: "" };
}

function withService(
  options: {
    readonly fetch: (
      command: Parameters<GitCommandRunner["run"]>[0],
    ) => ReturnType<GitCommandRunner["run"]>;
    readonly setting?: string;
  },
  test: (
    service: RepositoryFreshnessService,
    watch: { close: ReturnType<typeof vi.fn>; change: () => void },
  ) => Promise<void>,
) {
  const entry: RepositoryCatalogEntry = {
    id: repositoryId,
    logicalRepositoryId: repositoryId,
    path: "/repo",
    name: "repo",
    addedAt: "2026-09-04T00:00:00.000Z",
    lastOpenedAt: "2026-09-04T00:00:00.000Z",
  };
  const catalog: RepositoryCatalog = {
    find: (id) =>
      Effect.succeed({
        ...entry,
        id,
        path: id === linkedId ? "/linked" : entry.path,
      }),
    list: () => Effect.succeed([entry]),
    recordOpened: () => Effect.succeed(entry),
    remember: () => Effect.succeed(entry),
    remove: (id) => Effect.succeed({ repositoryId: id }),
  };
  const git: GitCommandRunner = {
    run: (command) => {
      if (command.arguments[0] === "fetch") {
        expect(command.arguments).toEqual(["fetch"]);
        return options.fetch(command);
      }
      return Effect.succeed(
        output(
          0,
          command.arguments[0] === "rev-parse"
            ? "/repo/.git"
            : (options.setting ?? "inherit"),
        ),
      );
    },
  };
  const watch = { close: vi.fn(), change: () => {} };
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* acquireRepositoryFreshnessService({
        catalog,
        git,
        watcher: {
          watch: (_, change) => {
            watch.change = change;
            return Effect.succeed({ close: watch.close });
          },
        },
      });
      yield* Effect.promise(() => test(service, watch));
    }).pipe(Effect.scoped),
  );
}
