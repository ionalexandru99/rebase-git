import type {
  RepositoryCatalogEntry,
  RepositoryFetchSetting,
  RepositoryFreshness,
} from "@rebase/contracts";
import { Cause, Effect, Fiber, Option, Queue, Semaphore } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import type { RepositoryWatcher } from "#server/domain/repository-watcher.contract";
import {
  readRepositoryFetchSetting,
  writeRepositoryFetchSetting,
} from "#server/features/repository-history/freshness/repository-fetch-settings";
import type { FreshnessSubscription } from "#server/features/repository-history/freshness/watched-repository.contract";

export function acquireWatchedRepository(
  entry: RepositoryCatalogEntry,
  subscribers: Set<FreshnessSubscription>,
  git: GitCommandRunner,
  watcher: RepositoryWatcher,
) {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const mutex = yield* Semaphore.make(1);
    const setting = yield* readRepositoryFetchSetting(git, entry.path);
    const directory = yield* git
      .run({
        directory: entry.path,
        arguments: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new RepositoryHistoryError({
              cause,
              failure: { _tag: "RepositoryMissing", repositoryId: entry.id },
            }),
        ),
      );
    if (directory.exitCode !== 0 || directory.stdout.trim() === "")
      return yield* Effect.fail(
        new RepositoryHistoryError({
          failure: { _tag: "RepositoryMissing", repositoryId: entry.id },
        }),
      );
    let freshness: RepositoryFreshness = {
      fetching: false,
      stale: false,
      revision: 0,
      defaultIntervalSeconds: 300,
      setting,
    };
    let fetching:
      | {
          readonly identity: symbol;
          readonly fiber: Fiber.Fiber<RepositoryFreshness>;
        }
      | undefined;
    let scheduled: Fiber.Fiber<void> | undefined;
    let manualOwners = 0;
    let closed = false;
    const path = () => subscribers.values().next().value?.path ?? entry.path;
    const publish = () => {
      for (const subscriber of subscribers) subscriber.publish(freshness);
    };
    const authorized = () =>
      [...subscribers].some((subscriber) => subscriber.automaticFetch);

    const stopSchedule = Effect.gen(function* () {
      const previous = scheduled;
      scheduled = undefined;
      if (previous !== undefined) yield* Fiber.interrupt(previous);
    });
    const reschedule: Effect.Effect<void> = Effect.gen(function* () {
      yield* stopSchedule;
      if (
        closed ||
        fetching !== undefined ||
        !authorized() ||
        freshness.setting._tag === "Disabled"
      )
        return;
      const seconds =
        freshness.setting._tag === "Interval"
          ? freshness.setting.seconds
          : freshness.defaultIntervalSeconds;
      scheduled = yield* Effect.gen(function* () {
        yield* Effect.sleep(seconds * 1_000);
        yield* Effect.gen(function* () {
          scheduled = undefined;
          if (authorized()) yield* beginFetch;
        }).pipe(Semaphore.withPermit(mutex));
      }).pipe(Effect.asVoid, Effect.forkIn(scope));
    });
    const completeFetch = (failure: RepositoryFreshness["failure"]) => {
      const { failure: previousFailure, ...state } = freshness;
      freshness = {
        ...state,
        fetching: false,
        stale: failure !== undefined,
        revision: state.revision + 1,
        ...(failure === undefined ? {} : { failure }),
      };
      publish();
      return freshness;
    };
    const performFetch = (identity: symbol) =>
      Effect.suspend(() =>
        git.run({
          directory: path(),
          arguments: ["fetch"],
          timeoutMilliseconds: 120_000,
        }),
      ).pipe(
        Effect.map((output): RepositoryFreshness["failure"] =>
          output.exitCode === 0
            ? undefined
            : { _tag: "FetchFailed", reason: "Failed" },
        ),
        Effect.catchCause((cause) => {
          if (Cause.hasInterrupts(cause))
            return Effect.failCause(Cause.interrupt());
          const error = Cause.findErrorOption(cause);
          return Effect.succeed({
            _tag: "FetchFailed",
            reason: Option.isSome(error) ? error.value.reason : "Failed",
          } as const);
        }),
        Effect.map((failure) =>
          fetching?.identity === identity ? completeFetch(failure) : freshness,
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            if (fetching?.identity !== identity) return;
            fetching = undefined;
            if (freshness.fetching) {
              freshness = { ...freshness, fetching: false };
              if (!closed) publish();
            }
            yield* reschedule;
          }).pipe(Semaphore.withPermit(mutex)),
        ),
      );
    const beginFetch = Effect.gen(function* () {
      if (fetching !== undefined) return fetching.fiber;
      yield* stopSchedule;
      freshness = { ...freshness, fetching: true };
      publish();
      const identity = Symbol();
      const fiber = yield* performFetch(identity).pipe(Effect.forkIn(scope));
      fetching = { identity, fiber };
      return fiber;
    });
    const startFetch = beginFetch.pipe(Semaphore.withPermit(mutex));
    const releaseOwnership = Effect.gen(function* () {
      const abandoned = yield* Effect.gen(function* () {
        if (authorized()) return undefined;
        yield* stopSchedule;
        if (manualOwners !== 0 || fetching === undefined) return undefined;
        const abandoned = fetching.fiber;
        fetching = undefined;
        freshness = { ...freshness, fetching: false };
        if (!closed) publish();
        return abandoned;
      }).pipe(Semaphore.withPermit(mutex));
      if (abandoned !== undefined) yield* Fiber.interrupt(abandoned);
    });
    const fetch = Effect.acquireUseRelease(
      Effect.sync(() => {
        manualOwners += 1;
      }),
      () => startFetch.pipe(Effect.flatMap(Fiber.join)),
      () =>
        Effect.gen(function* () {
          manualOwners -= 1;
          yield* releaseOwnership;
        }),
    );

    const changes = yield* Queue.make<void>({
      capacity: 1,
      strategy: "dropping",
    });
    yield* Effect.acquireRelease(
      watcher.watch(directory.stdout.trim(), () => {
        Queue.offerUnsafe(changes, undefined);
      }),
      (handle) => Effect.sync(handle.close),
    );
    yield* Effect.gen(function* () {
      while (true) {
        yield* Queue.take(changes);
        yield* Effect.sleep(50);
        yield* Queue.clear(changes);
        freshness = { ...freshness, revision: freshness.revision + 1 };
        publish();
      }
    }).pipe(Effect.forkScoped);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      }),
    );

    return {
      fetch,
      releaseOwnership,
      observe: (subscription: FreshnessSubscription) =>
        Effect.gen(function* () {
          subscription.publish(freshness);
          if (
            subscription.automaticFetch &&
            fetching === undefined &&
            scheduled === undefined &&
            freshness.setting._tag !== "Disabled"
          )
            yield* beginFetch;
        }).pipe(Semaphore.withPermit(mutex)),
      configure: (setting: RepositoryFetchSetting) =>
        Effect.gen(function* () {
          yield* writeRepositoryFetchSetting(git, path(), setting);
          freshness = { ...freshness, setting };
          publish();
          yield* reschedule;
          return freshness;
        }).pipe(Semaphore.withPermit(mutex), (configure) =>
          Effect.acquireUseRelease(
            configure.pipe(Effect.forkIn(scope)),
            Fiber.join,
            Fiber.interrupt,
          ),
        ),
    };
  });
}
