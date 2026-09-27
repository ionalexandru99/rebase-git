import type {
  RepositoryCatalogEntry,
  RepositoryChangeKind,
  RepositoryFreshness,
} from "@rebase/contracts";
import { Deferred, Effect, Exit, Fiber, type Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  type GitCommandRunner,
  gitFailed,
} from "#server/adapters/local-git/git-commands";
import type { RepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import {
  acquireRepositoryFreshness,
  type RepositoryFreshnessService,
} from "#server/features/repository-history/freshness/repository-freshness";
import { createRepositoryAccess } from "#server/repository/repository-access";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const linkedId = "00000000-0000-4000-8000-000000000002";

describe("repository freshness", () => {
  it("publishes a new revision for ref changes but not for index changes", () => {
    const states: RepositoryFreshness[] = [];
    return withService({ setting: "0" }, (service, watch) =>
      Effect.gen(function* () {
        const subscription = yield* service.subscribe(repositoryId, (state) =>
          states.push(state),
        );
        const beforeChange = states.at(-1)?.revision ?? 0;
        watch.change("Index");
        yield* TestClock.adjust(0);
        expect(states.at(-1)?.revision ?? 0).toBe(beforeChange);
        watch.change("Refs");
        yield* TestClock.adjust(0);
        expect(states.at(-1)?.revision).toBeGreaterThan(beforeChange);
        yield* subscription;
        expect(watch.close).toHaveBeenCalledOnce();
      }),
    );
  });

  it("shares fetch callers and preserves work when one caller or subscriber leaves", () => {
    return withService({}, (service, _watch, git) =>
      Effect.gen(function* () {
        const finish = yield* Deferred.make<void>();
        const interrupted = vi.fn();
        git.fetch.mockImplementation(() =>
          Deferred.await(finish).pipe(
            Effect.as(output()),
            Effect.onInterrupt(() => Effect.sync(interrupted)),
          ),
        );
        yield* service.subscribe(repositoryId, () => {});
        const closeWriter = yield* service.subscribe(linkedId, () => {});
        const first = yield* service.fetch(repositoryId).pipe(Effect.forkChild);
        const second = yield* service.fetch(linkedId).pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        expect(git.fetch).toHaveBeenCalledOnce();
        yield* closeWriter;
        yield* Fiber.interrupt(first);
        expect(interrupted).not.toHaveBeenCalled();
        yield* Deferred.succeed(finish, undefined);
        expect(yield* Fiber.join(second)).toMatchObject({
          fetching: false,
          stale: false,
        });
      }),
    );
  });

  it("recovers after typed failure and runner defects", () =>
    withService({ setting: "0" }, (service, _watch, git) =>
      Effect.gen(function* () {
        const states: RepositoryFreshness[] = [];
        git.fetch
          .mockImplementationOnce(() =>
            Effect.die(new Error("Unexpected runner defect")),
          )
          .mockImplementationOnce(() => Effect.fail(gitFailed("Timeout")));
        yield* service.subscribe(repositoryId, (state) => states.push(state));
        expect(yield* service.fetch(repositoryId)).toMatchObject({
          stale: true,
          fetching: false,
          failure: { _tag: "FetchFailed" },
        });
        expect(yield* service.fetch(repositoryId)).toMatchObject({
          stale: true,
          fetching: false,
          failure: { _tag: "FetchFailed", reason: "Timeout" },
        });
        expect(states.at(-1)).toMatchObject({
          fetching: false,
          stale: true,
          failure: { _tag: "FetchFailed", reason: "Timeout" },
        });
        expect(yield* service.fetch(repositoryId)).toMatchObject({
          stale: false,
          fetching: false,
        });
      }),
    ));

  it("replaces schedules and starts the next interval after fetch completion", () =>
    withService({ setting: "0" }, (service, _watch, git) =>
      Effect.gen(function* () {
        yield* service.subscribe(repositoryId, () => {});
        yield* service.configure(repositoryId, {
          _tag: "Interval",
          seconds: 10,
        });
        yield* TestClock.adjust(5_000);
        yield* service.configure(repositoryId, {
          _tag: "Interval",
          seconds: 20,
        });
        yield* TestClock.adjust(19_000);
        expect(git.fetch).not.toHaveBeenCalled();
        yield* TestClock.adjust(1_000);
        expect(git.fetch).toHaveBeenCalledTimes(1);
        yield* TestClock.adjust(19_000);
        yield* service.fetch(repositoryId);
        yield* TestClock.adjust(1_000);
        expect(git.fetch).toHaveBeenCalledTimes(2);
        yield* TestClock.adjust(19_000);
        expect(git.fetch).toHaveBeenCalledTimes(3);
        yield* service.configure(repositoryId, { _tag: "Disabled" });
        yield* TestClock.adjust(60_000);
        expect(git.fetch).toHaveBeenCalledTimes(3);
      }),
    ));

  it("discards an expired schedule while replacement configuration is being written", () =>
    withService({ setting: "10" }, (service, _watch, git) =>
      Effect.gen(function* () {
        yield* service.subscribe(repositoryId, () => {});
        yield* TestClock.adjust(5_000);
        const configured = yield* Deferred.make<void>();
        git.initialize = Deferred.await(configured);
        const configuring = yield* service
          .configure(repositoryId, { _tag: "Disabled" })
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(10_000);
        yield* Deferred.succeed(configured, undefined);
        yield* Fiber.join(configuring);
        yield* TestClock.adjust(60_000);
        expect(git.fetch).toHaveBeenCalledOnce();
      }),
    ));

  it("retries automatic fetch after failure and honors configuration changed during fetch", () =>
    withService({ setting: "10" }, (service, _watch, git) =>
      Effect.gen(function* () {
        git.fetch.mockImplementationOnce(() => Effect.succeed(output(1)));
        const states: RepositoryFreshness[] = [];
        yield* service.subscribe(repositoryId, (state) => states.push(state));
        yield* TestClock.adjust(0);
        expect(states.at(-1)).toMatchObject({ stale: true });
        const finish = yield* Deferred.make<void>();
        git.fetch.mockImplementationOnce(() =>
          Deferred.await(finish).pipe(Effect.as(output())),
        );
        yield* TestClock.adjust(10_000);
        expect(git.fetch).toHaveBeenCalledTimes(2);
        yield* service.configure(repositoryId, { _tag: "Disabled" });
        yield* Deferred.succeed(finish, undefined);
        yield* TestClock.adjust(60_000);
        expect(states.at(-1)).toMatchObject({
          stale: false,
          fetching: false,
          setting: { _tag: "Disabled" },
        });
        expect(git.fetch).toHaveBeenCalledTimes(2);
      }),
    ));

  it("shares linked worktree watching and fetches through a surviving path", () =>
    withService({ setting: "0" }, (service, watch, git) =>
      Effect.gen(function* () {
        const publish = vi.fn();
        const first = yield* service.subscribe(repositoryId, publish);
        const second = yield* service.subscribe(linkedId, publish);
        expect(watch.open).toHaveBeenCalledOnce();
        yield* first;
        expect(watch.close).not.toHaveBeenCalled();
        yield* service.fetch(linkedId);
        expect(git.fetch).toHaveBeenCalledWith(
          expect.objectContaining({ directory: "/linked" }),
        );
        yield* second;
        expect(watch.close).toHaveBeenCalledOnce();
        const published = publish.mock.calls.length;
        watch.change("Refs");
        yield* TestClock.adjust(60_000);
        expect(publish).toHaveBeenCalledTimes(published);
      }),
    ));

  it("leaves shared initialization running when one subscriber is interrupted", () =>
    withService({}, (service, watch, git) =>
      Effect.gen(function* () {
        const initialize = yield* Deferred.make<void>();
        git.initialize = Deferred.await(initialize);
        const first = yield* service
          .subscribe(repositoryId, () => {})
          .pipe(Effect.forkChild);
        const second = yield* service
          .subscribe(linkedId, () => {})
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        yield* Fiber.interrupt(first);
        yield* Deferred.succeed(initialize, undefined);
        const release = yield* Fiber.join(second);
        expect(watch.open).toHaveBeenCalledOnce();
        yield* release;
        expect(watch.close).toHaveBeenCalledOnce();
      }),
    ));

  it("interrupts abandoned initialization and permits a later subscription", () =>
    withService({}, (service, watch, git) =>
      Effect.gen(function* () {
        const interrupted = vi.fn();
        git.initialize = Effect.never.pipe(
          Effect.ensuring(Effect.sync(interrupted)),
        );
        const opening = yield* service
          .subscribe(repositoryId, () => {})
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        yield* Fiber.interrupt(opening);
        expect(interrupted).toHaveBeenCalledOnce();
        git.initialize = Effect.void;
        const release = yield* service.subscribe(repositoryId, () => {});
        yield* release;
        expect(watch.close).toHaveBeenCalledOnce();
      }),
    ));

  it("starts one immediate fetch for concurrently initialized writer subscriptions", () =>
    withService({}, (service, _watch, git) =>
      Effect.gen(function* () {
        const initialize = yield* Deferred.make<void>();
        git.initialize = Deferred.await(initialize);
        const first = yield* service
          .subscribe(repositoryId, () => {})
          .pipe(Effect.forkChild);
        const second = yield* service
          .subscribe(linkedId, () => {})
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        yield* Deferred.succeed(initialize, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        yield* TestClock.adjust(0);
        expect(git.fetch).toHaveBeenCalledOnce();
      }),
    ));

  it("does not postpone scheduled fetch when a reader leaves", () =>
    withService({ setting: "10" }, (service, _watch, git) =>
      Effect.gen(function* () {
        yield* service.subscribe(repositoryId, () => {});
        const reader = yield* service.subscribe(linkedId, () => {});
        yield* TestClock.adjust(5_000);
        yield* reader;
        yield* TestClock.adjust(5_000);
        expect(git.fetch).toHaveBeenCalledTimes(2);
      }),
    ));

  it("interrupts configuration when its repository lifetime ends", () =>
    withService({}, (service, watch, git) =>
      Effect.gen(function* () {
        const release = yield* service.subscribe(repositoryId, () => {});
        const interrupted = vi.fn();
        git.initialize = Effect.never.pipe(
          Effect.ensuring(Effect.sync(interrupted)),
        );
        const configuring = yield* service
          .configure(repositoryId, { _tag: "Disabled" })
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        yield* release;
        expect(Exit.isFailure(yield* Fiber.await(configuring))).toBe(true);
        expect(interrupted).toHaveBeenCalledOnce();
        expect(watch.close).toHaveBeenCalledOnce();
      }),
    ));

  it("closes watching and interrupts work when the service scope ends", async () => {
    const interrupted = vi.fn();
    const fetch = vi.fn(() =>
      Effect.never.pipe(Effect.ensuring(Effect.sync(interrupted))),
    );
    let watchClosed: ReturnType<typeof vi.fn> | undefined;
    await withService({ fetch }, (service, watch) =>
      Effect.gen(function* () {
        watchClosed = watch.close;
        yield* service.subscribe(repositoryId, () => {});
        yield* TestClock.adjust(0);
      }),
    );
    expect(interrupted).toHaveBeenCalledOnce();
    expect(watchClosed).toHaveBeenCalledOnce();
  });
});

function output(exitCode = 0, stdout = "") {
  return { exitCode, stdout, stderr: "" };
}

function withService(
  options: {
    readonly fetch?: GitCommandRunner["run"];
    readonly setting?: string;
  },
  test: (
    service: RepositoryFreshnessService,
    watch: {
      open: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      change: (kind: RepositoryChangeKind) => void;
    },
    git: {
      fetch: ReturnType<typeof vi.fn<GitCommandRunner["run"]>>;
      initialize: Effect.Effect<void>;
    },
  ) => Effect.Effect<void, unknown, Scope.Scope>,
) {
  const entry: RepositoryCatalogEntry = {
    id: repositoryId,
    logicalRepositoryId: repositoryId,
    path: "/repo",
    name: "repo",
    addedAt: "2026-09-04T00:00:00.000Z",
    lastOpenedAt: "2026-09-04T00:00:00.000Z",
  };
  const git = {
    fetch: vi.fn<GitCommandRunner["run"]>(
      options.fetch ?? (() => Effect.succeed(output())),
    ),
    initialize: Effect.void,
  };
  const watch = {
    open: vi.fn(),
    close: vi.fn(),
    change: (_kind: RepositoryChangeKind) => {},
  };
  return Effect.runPromise(
    Effect.gen(function* () {
      const runner: GitCommandRunner = {
        stream: () => Stream.empty,
        run: (command) =>
          command.arguments[0] === "fetch"
            ? git.fetch(command)
            : command.arguments.includes("rev-parse")
              ? Effect.succeed(output(0, "/repo/.git"))
              : git.initialize.pipe(
                  Effect.as(output(0, options.setting ?? "inherit")),
                ),
      };
      const watcher: RepositoryWatcher = {
        watch: (_, change) =>
          Effect.sync(() => {
            watch.open();
            watch.change = change;
            return { close: watch.close };
          }),
      };
      const service = yield* acquireRepositoryFreshness({
        access: createRepositoryAccess(
          {
            find: (id) =>
              Effect.succeed({
                ...entry,
                id,
                path: id === linkedId ? "/linked" : entry.path,
              }),
          },
          runner,
          watcher,
        ),
        coordination: {
          run: (_directory, _policy, operation) => operation,
          operation: () => Effect.die("Freshness never reads operations."),
        },
        git: runner,
        watcher,
      });
      yield* test(service, watch, git);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
}
