import type {
  RepositoryCatalogEntry,
  RepositoryFetchSetting,
  RepositoryFreshness,
  RepositoryHistoryOperationFailure,
} from "@rebase/contracts";
import { Cause, Effect, Fiber, Option, Queue, Semaphore } from "effect";
import {
  type GitCommandRunner,
  readGitCommonDirectory,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands";
import type { RepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { historyFailed } from "#server/features/repository-history/git/history-failures";
import type { RepositoryCoordination } from "#server/repository/repository-coordination";

export interface FreshnessSubscription {
  readonly path: string;
  readonly publish: (freshness: RepositoryFreshness) => void;
}

export function acquireWatchedRepository(
  entry: RepositoryCatalogEntry,
  subscribers: Set<FreshnessSubscription>,
  git: GitCommandRunner,
  watcher: RepositoryWatcher,
  coordination: RepositoryCoordination,
) {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const mutex = yield* Semaphore.make(1);
    const setting = yield* readRepositoryFetchSetting(git, entry.path);
    const directory = yield* readGitCommonDirectory(git, entry.path).pipe(
      Effect.mapError(
        (): RepositoryHistoryOperationFailure => ({
          _tag: "RepositoryMissing",
          repositoryId: entry.id,
        }),
      ),
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
    let closed = false;
    const path = () => subscribers.values().next().value?.path ?? entry.path;
    const publish = () => {
      for (const subscriber of subscribers) subscriber.publish(freshness);
    };

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
        subscribers.size === 0 ||
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
          if (subscribers.size > 0) yield* beginFetch;
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
      Effect.suspend(() => {
        const directory = path();
        return coordination.run(
          directory,
          {
            name: "fetch",
            locks: { refs: "ifAvailable" },
            duringOperation: "proceed",
          },
          runRepositoryGit(git, directory, ["fetch"], {
            timeoutMilliseconds: 120_000,
          }),
        );
      }).pipe(
        Effect.as<RepositoryFreshness["failure"]>(undefined),
        Effect.catchCause((cause) => {
          if (Cause.hasInterrupts(cause))
            return Effect.failCause(Cause.interrupt());
          const error = Cause.findErrorOption(cause);
          return Effect.succeed({
            _tag: "FetchFailed",
            reason:
              Option.isSome(error) && error.value._tag === "GitFailed"
                ? error.value.reason
                : "Failed",
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
    const fetch = startFetch.pipe(Effect.flatMap(Fiber.join));

    const changes = yield* Queue.make<void>({
      capacity: 1,
      strategy: "dropping",
    });
    yield* Effect.acquireRelease(
      watcher.watch(directory, (kind) => {
        if (kind === "Refs") Queue.offerUnsafe(changes, undefined);
      }),
      (handle) => Effect.sync(handle.close),
    );
    yield* Effect.gen(function* () {
      while (true) {
        yield* Queue.take(changes);
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
      observe: (subscription: FreshnessSubscription) =>
        Effect.gen(function* () {
          subscription.publish(freshness);
          if (
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

const settingKey = "rebase.autoFetchIntervalSeconds";

function readRepositoryFetchSetting(git: GitCommandRunner, path: string) {
  return runRepositoryGit(
    git,
    path,
    ["config", "--local", "--get", settingKey],
    { exitCodes: [0, 1] },
  ).pipe(
    Effect.map((output): RepositoryFetchSetting => {
      const value = output.trim();
      const seconds = Number(value);
      return value === "0"
        ? { _tag: "Disabled" }
        : Number.isInteger(seconds) && seconds > 0 && seconds <= 86_400
          ? { _tag: "Interval", seconds }
          : { _tag: "Inherit" };
    }),
    Effect.mapError(settingsError),
  );
}

function writeRepositoryFetchSetting(
  git: GitCommandRunner,
  path: string,
  setting: RepositoryFetchSetting,
) {
  const value =
    setting._tag === "Disabled"
      ? "0"
      : setting._tag === "Interval"
        ? String(setting.seconds)
        : "inherit";
  return runRepositoryGit(git, path, [
    "config",
    "--local",
    settingKey,
    value,
  ]).pipe(Effect.asVoid, Effect.mapError(settingsError));
}

function settingsError() {
  return historyFailed("Could not access repository fetch settings");
}
