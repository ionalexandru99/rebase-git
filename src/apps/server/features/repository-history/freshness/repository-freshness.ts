import type {
  RepositoryFetchSetting,
  RepositoryFreshness,
  RepositoryHistoryOperationFailure,
} from "@rebase/contracts";
import { Effect, Exit, Fiber, Scope } from "effect";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands";
import type { RepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import {
  acquireWatchedRepository,
  type FreshnessSubscription,
} from "#server/features/repository-history/freshness/watched-repository";
import { findHistoryRepository } from "#server/features/repository-history/git/history-failures";
import type { RepositoryAccess } from "#server/repository/repository-access";
import type { RepositoryCoordination } from "#server/repository/repository-coordination";

interface RepositoryLifetime {
  readonly scope: Scope.Closeable;
  readonly subscribers: Set<FreshnessSubscription>;
  readonly repository: Fiber.Fiber<
    Effect.Success<ReturnType<typeof acquireWatchedRepository>>,
    RepositoryHistoryOperationFailure
  >;
}

export type RepositoryFreshnessService = Effect.Success<
  ReturnType<typeof acquireRepositoryFreshness>
>;

export function acquireRepositoryFreshness({
  access,
  coordination,
  git,
  watcher,
}: {
  readonly access: RepositoryAccess;
  readonly coordination: RepositoryCoordination;
  readonly git: GitCommandRunner;
  readonly watcher: RepositoryWatcher;
}) {
  return Effect.gen(function* () {
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
        if (lifetime.subscribers.size > 0) return;
        if (repositories.get(key) === lifetime) repositories.delete(key);
        for (const [alias, logicalId] of aliases)
          if (logicalId === key) aliases.delete(alias);
        yield* Scope.close(lifetime.scope, Exit.void);
      }).pipe(Effect.uninterruptible);

    const subscribe = (
      repositoryId: string,
      publish: (freshness: RepositoryFreshness) => void,
    ) =>
      Effect.gen(function* () {
        if (closed) return yield* Effect.fail(missingRepository(repositoryId));
        const entry = yield* findHistoryRepository(access, repositoryId);
        if (closed) return yield* Effect.fail(missingRepository(repositoryId));
        const key = entry.logicalRepositoryId ?? repositoryId;
        const subscription: FreshnessSubscription = {
          path: entry.path,
          publish,
        };
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            let lifetime = repositories.get(key);
            if (lifetime === undefined) {
              const repositoryScope = yield* Scope.fork(scope);
              const subscribers = new Set<FreshnessSubscription>();
              const repository = yield* acquireWatchedRepository(
                entry,
                subscribers,
                git,
                watcher,
                coordination,
              ).pipe(
                Effect.provideService(Scope.Scope, repositoryScope),
                Effect.forkIn(repositoryScope),
              );
              lifetime = {
                scope: repositoryScope,
                subscribers,
                repository,
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
      fetch: (repositoryId: string) =>
        active(repositoryId).pipe(
          Effect.flatMap((repository) => repository.fetch),
        ),
      configure: (repositoryId: string, setting: RepositoryFetchSetting) =>
        active(repositoryId).pipe(
          Effect.flatMap((repository) => repository.configure(setting)),
        ),
    };
  });
}

function missingRepository(
  repositoryId: string,
): RepositoryHistoryOperationFailure {
  return { _tag: "RepositoryMissing", repositoryId };
}
