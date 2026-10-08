import { Effect, Exit, Queue, Scope, Semaphore } from "effect";
import type { RepositoryChangeKind } from "#contracts/environment-connection/environment-rpc.contract.ts";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type GitCommandRunner,
  readGitCommonDirectory,
} from "#server/adapters/local-git/git-commands.ts";
import type { RepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher.ts";

export interface RepositoryChangePublisher {
  readonly watch: (repository: RepositoryCatalogEntry) => Effect.Effect<void>;
  readonly restart: (repositoryId: string) => Effect.Effect<void>;
  readonly watchers: () => readonly WatchedRepository[];
}

export interface WatchedRepository {
  readonly repositoryId: string;
  readonly failure?: string;
}

interface Watched {
  readonly scope: Scope.Closeable;
  readonly repository: RepositoryCatalogEntry;
  failure?: string;
}

const maximumWatchedRepositories = 32;

export function acquireRepositoryChangePublisher(
  git: GitCommandRunner,
  watcher: RepositoryWatcher,
  events: EnvironmentEventPublisher,
  onWatchFailure: (repositoryId: string, detail: string) => void = () => {},
): Effect.Effect<RepositoryChangePublisher, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const mutex = yield* Semaphore.make(1);
    const watches = new Map<string, Watched>();
    const changed = new Map<string, RepositoryChangeKind>();
    const pending = yield* Queue.make<void>({
      capacity: 1,
      strategy: "dropping",
    });
    let closed = false;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
        watches.clear();
        changed.clear();
      }),
    );
    yield* publishRepositoryChanges(pending, changed, events).pipe(
      Effect.forkScoped,
    );

    const unwatch = (repositoryId: string) =>
      Effect.gen(function* () {
        const watched = watches.get(repositoryId);
        if (watched === undefined) return;
        watches.delete(repositoryId);
        yield* Scope.close(watched.scope, Exit.void);
      });

    const register = (repository: RepositoryCatalogEntry, directory: string) =>
      Effect.gen(function* () {
        const oldest = watches.keys().next().value;
        if (watches.size >= maximumWatchedRepositories && oldest !== undefined)
          yield* unwatch(oldest);
        const owned = yield* Scope.fork(scope);
        const watched: Watched = { scope: owned, repository };
        watches.set(repository.id, watched);
        yield* Effect.acquireRelease(
          watcher.watch(directory, {
            changed: (kind) => {
              if (changed.get(repository.id) !== "Refs")
                changed.set(repository.id, kind);
              Queue.offerUnsafe(pending, undefined);
            },
            failed: (detail) => {
              if (watched.failure !== undefined) return;
              watched.failure = detail;
              onWatchFailure(repository.id, detail);
            },
          }),
          (handle) => Effect.sync(handle.close),
        ).pipe(Effect.provideService(Scope.Scope, owned));
      }).pipe(Effect.uninterruptible);

    const watch = (repository: RepositoryCatalogEntry) =>
      Effect.gen(function* () {
        if (closed || watches.has(repository.id)) return;
        const directory = yield* readGitCommonDirectory(git, repository.path, {
          timeoutMilliseconds: 5_000,
        }).pipe(Effect.catch(() => Effect.succeed(undefined)));
        if (closed || directory === undefined) return;
        yield* register(repository, directory);
      });

    return {
      watch: (repository) =>
        watch(repository).pipe(Semaphore.withPermit(mutex)),
      restart: (repositoryId) =>
        Effect.gen(function* () {
          const watched = watches.get(repositoryId);
          if (watched === undefined) return;
          yield* unwatch(repositoryId);
          yield* watch(watched.repository);
        }).pipe(Semaphore.withPermit(mutex)),
      watchers: () =>
        [...watches].map(([repositoryId, { failure }]) =>
          failure === undefined ? { repositoryId } : { repositoryId, failure },
        ),
    } satisfies RepositoryChangePublisher;
  });
}

function publishRepositoryChanges(
  pending: Queue.Queue<void>,
  changed: Map<string, RepositoryChangeKind>,
  events: EnvironmentEventPublisher,
) {
  return Effect.gen(function* () {
    while (true) {
      yield* Queue.take(pending);
      yield* Queue.clear(pending);
      const batch = [...changed];
      changed.clear();
      for (const kind of ["Refs", "Index"] as const) {
        const repositoryIds = batch.flatMap(([repositoryId, changedKind]) =>
          changedKind === kind ? [repositoryId] : [],
        );
        if (repositoryIds.length > 0)
          events.publishChanged(repositoryIds, kind);
      }
    }
  });
}
