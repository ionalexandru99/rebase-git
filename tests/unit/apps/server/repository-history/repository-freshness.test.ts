import type {
  EnvironmentAccessCapability,
  EnvironmentServerMessage,
  RepositoryCatalogEntry,
  RepositoryFreshness,
} from "@rebase/contracts";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Layer,
  type Scope,
} from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  GitCommandError,
  type GitCommandRunner,
  GitCommands,
} from "#server/domain/git-command.contract";
import { RepositoryCatalogAccess } from "#server/domain/repository-catalog.contract";
import {
  type RepositoryFreshnessService,
  RepositoryFreshnessState,
} from "#server/domain/repository-freshness.contract";
import { RepositoryWatching } from "#server/domain/repository-watcher.contract";
import { acquireRepositoryFreshnessSession } from "#server/features/environment-connection/websocket/repository-freshness-session";
import { repositoryFreshnessLayer } from "#server/features/repository-history/freshness/repository-freshness";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const linkedId = "00000000-0000-4000-8000-000000000002";
const writer = { automaticFetch: true };

describe("repository freshness", () => {
  it("keeps read-only sessions observing while automatic fetch belongs to subscribed writers", () => {
    const fetch = vi.fn(() => Effect.succeed(output()));
    const messages: EnvironmentServerMessage[] = [];
    return withService({ fetch }, (service, watch) =>
      Effect.gen(function* () {
        const reader = yield* openSession(
          service,
          ["repository.read"],
          messages,
        );
        yield* reader({
          _tag: "SubscribeRepositoryHistory",
          repositoryId,
          requestId: repositoryId,
        });
        yield* TestClock.adjust(300_000);
        expect(fetch).not.toHaveBeenCalled();
        watch.change();
        yield* TestClock.adjust(50);
        expect(messages.at(-1)).toMatchObject({ freshness: { revision: 1 } });
        yield* Effect.gen(function* () {
          const handle = yield* openSession(
            service,
            ["repository.read", "repository.write"],
            [],
          );
          yield* handle({
            _tag: "SubscribeRepositoryHistory",
            repositoryId,
            requestId: linkedId,
          });
          yield* TestClock.adjust(0);
          expect(fetch).toHaveBeenCalledTimes(1);
          yield* handle({
            _tag: "FetchRepositoryHistory",
            repositoryId,
            requestId: linkedId,
          });
          yield* TestClock.adjust(0);
          expect(fetch).toHaveBeenCalledTimes(2);
          yield* TestClock.adjust(300_000);
          expect(fetch).toHaveBeenCalledTimes(3);
        }).pipe(Effect.scoped);
        yield* TestClock.adjust(600_000);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(watch.close).not.toHaveBeenCalled();
        watch.change();
        yield* TestClock.adjust(50);
        expect(messages.at(-1)).toMatchObject({ freshness: { revision: 5 } });
        yield* reader({ _tag: "UnsubscribeRepositoryHistory", repositoryId });
        expect(watch.close).toHaveBeenCalledOnce();
      }),
    );
  });

  it("interrupts automatic fetch only after its final writer leaves", () => {
    const states: RepositoryFreshness[] = [];
    const interrupted = vi.fn();
    const fetch = vi.fn(() =>
      Effect.never.pipe(Effect.ensuring(Effect.sync(interrupted))),
    );
    return withService({ fetch }, (service, watch) =>
      Effect.gen(function* () {
        yield* service.subscribe(repositoryId, (state) => states.push(state));
        const first = yield* service.subscribe(repositoryId, () => {}, writer);
        const second = yield* service.subscribe(linkedId, () => {}, writer);
        yield* TestClock.adjust(0);
        expect(fetch).toHaveBeenCalledOnce();
        yield* first;
        expect(interrupted).not.toHaveBeenCalled();
        yield* second;
        expect(interrupted).toHaveBeenCalledOnce();
        expect(states.at(-1)).toMatchObject({ fetching: false, stale: false });
        expect(states.at(-1)?.failure).toBeUndefined();
        expect(watch.close).not.toHaveBeenCalled();
        yield* TestClock.adjust(600_000);
        expect(fetch).toHaveBeenCalledOnce();
      }),
    );
  });

  it("shares fetch callers and preserves work when one caller or automatic owner leaves", () => {
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
        const closeWriter = yield* service.subscribe(
          linkedId,
          () => {},
          writer,
        );
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

  it("starts fresh work while an abandoned fetch finishes cancellation", () =>
    withService({}, (service, _watch, git) =>
      Effect.gen(function* () {
        const cleanupStarted = yield* Deferred.make<void>();
        const cleanupFinished = yield* Deferred.make<void>();
        const replacementFinished = yield* Deferred.make<void>();
        git.fetch.mockImplementationOnce(() =>
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Deferred.succeed(cleanupStarted, undefined).pipe(
                Effect.andThen(Deferred.await(cleanupFinished)),
              ),
            ),
          ),
        );
        git.fetch.mockImplementation(() =>
          Deferred.await(replacementFinished).pipe(Effect.as(output())),
        );
        yield* service.subscribe(repositoryId, () => {});
        const first = yield* service.fetch(repositoryId).pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        const closing = yield* Fiber.interrupt(first).pipe(Effect.forkChild);
        yield* Deferred.await(cleanupStarted);
        const replacement = yield* service
          .fetch(repositoryId)
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        const fetchesDuringCleanup = git.fetch.mock.calls.length;
        yield* Deferred.succeed(cleanupFinished, undefined);
        yield* Fiber.join(closing);
        const shared = yield* service
          .fetch(repositoryId)
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        yield* Deferred.succeed(replacementFinished, undefined);
        const replacementResult = yield* Fiber.await(replacement);
        const sharedResult = yield* Fiber.await(shared);
        expect(fetchesDuringCleanup).toBe(2);
        expect(git.fetch).toHaveBeenCalledTimes(2);
        expect(Exit.isSuccess(replacementResult)).toBe(true);
        expect(Exit.isSuccess(sharedResult)).toBe(true);
      }),
    ));

  it("interrupts an explicit fetch once every caller leaves", () =>
    withService({}, (service, _watch, git) =>
      Effect.gen(function* () {
        const interrupted = vi.fn();
        git.fetch.mockImplementation(() =>
          Effect.never.pipe(Effect.ensuring(Effect.sync(interrupted))),
        );
        yield* service.subscribe(repositoryId, () => {});
        const caller = yield* service
          .fetch(repositoryId)
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        yield* Fiber.interrupt(caller);
        expect(interrupted).toHaveBeenCalledOnce();
      }),
    ));

  it("recovers after typed failure and runner defects", () =>
    withService({ setting: "0" }, (service, _watch, git) =>
      Effect.gen(function* () {
        const states: RepositoryFreshness[] = [];
        git.fetch
          .mockImplementationOnce(() =>
            Effect.die(new Error("Unexpected runner defect")),
          )
          .mockImplementationOnce(() =>
            Effect.fail(new GitCommandError({ reason: "Timeout" })),
          );
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
        git.fetch.mockImplementationOnce(() => Effect.never);
        const canceled = yield* service
          .fetch(repositoryId)
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(0);
        yield* Fiber.interrupt(canceled);
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
        yield* service.subscribe(repositoryId, () => {}, writer);
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
        yield* service.subscribe(repositoryId, () => {}, writer);
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
        yield* service.subscribe(
          repositoryId,
          (state) => states.push(state),
          writer,
        );
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
        watch.change();
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
          .subscribe(repositoryId, () => {}, writer)
          .pipe(Effect.forkChild);
        const second = yield* service
          .subscribe(linkedId, () => {}, writer)
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
        yield* service.subscribe(repositoryId, () => {}, writer);
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
        yield* service.subscribe(repositoryId, () => {}, writer);
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

function openSession(
  service: RepositoryFreshnessService,
  access: readonly EnvironmentAccessCapability[],
  messages: EnvironmentServerMessage[],
) {
  return Effect.gen(function* () {
    const run = yield* FiberSet.makeRuntime<never, void, never>();
    return yield* acquireRepositoryFreshnessSession(
      service,
      {
        send: (message) =>
          Effect.sync(() => {
            messages.push(message);
          }),
      },
      new Map([["repository-history-freshness", 1]]),
      new Set(access),
      run,
    );
  });
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
      change: () => void;
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
  const watch = { open: vi.fn(), close: vi.fn(), change: () => {} };
  return Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.build(
        repositoryFreshnessLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(RepositoryCatalogAccess, {
                find: (id) =>
                  Effect.succeed({
                    ...entry,
                    id,
                    path: id === linkedId ? "/linked" : entry.path,
                  }),
              }),
              Layer.succeed(GitCommands, {
                run: (command) =>
                  command.arguments[0] === "fetch"
                    ? git.fetch(command)
                    : command.arguments[0] === "rev-parse"
                      ? Effect.succeed(output(0, "/repo/.git"))
                      : git.initialize.pipe(
                          Effect.as(output(0, options.setting ?? "inherit")),
                        ),
              }),
              Layer.succeed(RepositoryWatching, {
                watch: (_, change) =>
                  Effect.sync(() => {
                    watch.open();
                    watch.change = change;
                    return { close: watch.close };
                  }),
              }),
            ),
          ),
        ),
      );
      yield* test(Context.get(context, RepositoryFreshnessState), watch, git);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
}
