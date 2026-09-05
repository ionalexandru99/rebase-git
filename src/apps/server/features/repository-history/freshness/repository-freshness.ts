import { Effect, Exit, Fiber, Layer, Scope } from "effect";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryCatalogAccess } from "#server/domain/repository-catalog.contract";
import {
  type RepositoryFreshnessService,
  RepositoryFreshnessState,
} from "#server/domain/repository-freshness.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import { RepositoryWatching } from "#server/domain/repository-watcher.contract";
import { acquireWatchedRepository } from "#server/features/repository-history/freshness/watched-repository";
import type { FreshnessSubscription } from "#server/features/repository-history/freshness/watched-repository.contract";

interface RepositoryLifetime {
  readonly releaseOwnership: Effect.Effect<void>;
  readonly scope: Scope.Closeable;
  readonly subscribers: Set<FreshnessSubscription>;
  readonly repository: Fiber.Fiber<
    Effect.Success<ReturnType<typeof acquireWatchedRepository>>,
    RepositoryHistoryError
  >;
}

export const repositoryFreshnessLayer = Layer.effect(
  RepositoryFreshnessState,
  Effect.gen(function* () {
    const catalog = yield* RepositoryCatalogAccess;
    const git = yield* GitCommands;
    const watcher = yield* RepositoryWatching;
    const scope = yield* Effect.scope;
    const repositories = new Map<string, RepositoryLifetime>();
    const aliases = new Map<string, string>();
    let closed = false;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
        repositories.clear();
        aliases.clear();
      }),
    );

    const release = (
      key: string,
      lifetime: RepositoryLifetime,
      subscription: FreshnessSubscription,
    ) =>
      Effect.gen(function* () {
        if (!lifetime.subscribers.delete(subscription)) return;
        if (lifetime.subscribers.size > 0) {
          yield* lifetime.releaseOwnership;
          return;
        }
        if (repositories.get(key) === lifetime) repositories.delete(key);
        for (const [alias, logicalId] of aliases)
          if (logicalId === key) aliases.delete(alias);
        yield* Scope.close(lifetime.scope, Exit.void);
      }).pipe(Effect.uninterruptible);

    const subscribe: RepositoryFreshnessService["subscribe"] = (
      repositoryId,
      publish,
      authorization,
    ) =>
      Effect.gen(function* () {
        if (closed) return yield* Effect.fail(missingRepository(repositoryId));
        const entry = yield* catalog
          .find(repositoryId)
          .pipe(Effect.mapError(historyError));
        if (entry === undefined || closed)
          return yield* Effect.fail(missingRepository(repositoryId));
        const key = entry.logicalRepositoryId ?? repositoryId;
        const subscription: FreshnessSubscription = {
          path: entry.path,
          publish,
          automaticFetch: authorization?.automaticFetch ?? false,
        };
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            let lifetime = repositories.get(key);
            if (lifetime === undefined) {
              let releaseOwnership = Effect.void;
              const repositoryScope = yield* Scope.fork(scope);
              const subscribers = new Set<FreshnessSubscription>();
              const repository = yield* acquireWatchedRepository(
                entry,
                subscribers,
                git,
                watcher,
              ).pipe(
                Effect.tap((repository) =>
                  Effect.sync(() => {
                    releaseOwnership = repository.releaseOwnership;
                  }),
                ),
                Effect.provideService(Scope.Scope, repositoryScope),
                Effect.forkIn(repositoryScope),
              );
              lifetime = {
                scope: repositoryScope,
                subscribers,
                repository,
                releaseOwnership: Effect.suspend(() => releaseOwnership),
              };
              repositories.set(key, lifetime);
            }
            aliases.set(repositoryId, key);
            lifetime.subscribers.add(subscription);
            const unsubscribe = release(key, lifetime, subscription);
            return yield* restore(
              Effect.gen(function* () {
                const repository = yield* Fiber.join(lifetime.repository);
                yield* repository.observe(subscription);
                return unsubscribe;
              }),
            ).pipe(
              Effect.onExit((exit) =>
                Exit.isFailure(exit) ? unsubscribe : Effect.void,
              ),
            );
          }),
        );
      });

    const active = (repositoryId: string) =>
      Effect.gen(function* () {
        const lifetime = repositories.get(
          aliases.get(repositoryId) ?? repositoryId,
        );
        if (closed || lifetime === undefined)
          return yield* Effect.fail(missingRepository(repositoryId));
        return yield* Fiber.join(lifetime.repository);
      });
    return {
      subscribe,
      fetch: (repositoryId) =>
        active(repositoryId).pipe(
          Effect.flatMap((repository) => repository.fetch),
        ),
      configure: (repositoryId, setting) =>
        active(repositoryId).pipe(
          Effect.flatMap((repository) => repository.configure(setting)),
        ),
    } satisfies RepositoryFreshnessService;
  }),
);

function missingRepository(repositoryId: string) {
  return new RepositoryHistoryError({
    failure: { _tag: "RepositoryMissing", repositoryId },
  });
}

function historyError(cause: unknown) {
  return new RepositoryHistoryError({
    cause,
    failure: { _tag: "GitFailed", reason: "Failed" },
  });
}
