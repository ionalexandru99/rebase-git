import { Effect, Exit, Queue, Scope, Semaphore } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryChangePublisher } from "#server/domain/repository-refs.contract";
import type { RepositoryWatcher } from "#server/domain/repository-watcher.contract";
import type { EnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher.contract";

const maximumWatchedRepositories = 32;
const publishDelayMilliseconds = 150;

export function acquireRepositoryChangePublisher(
  git: GitCommandRunner,
  watcher: RepositoryWatcher,
  events: EnvironmentEventPublisher,
): Effect.Effect<RepositoryChangePublisher, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const mutex = yield* Semaphore.make(1);
    const watches = new Map<string, Scope.Closeable>();
    const changed = new Set<string>();
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

    const register = (repositoryId: string, directory: string) =>
      Effect.gen(function* () {
        const oldest = watches.entries().next().value;
        if (
          watches.size >= maximumWatchedRepositories &&
          oldest !== undefined
        ) {
          watches.delete(oldest[0]);
          yield* Scope.close(oldest[1], Exit.void);
        }
        const owned = yield* Scope.fork(scope);
        yield* Effect.acquireRelease(
          watcher.watch(directory, () => {
            changed.add(repositoryId);
            Queue.offerUnsafe(pending, undefined);
          }),
          (handle) => Effect.sync(handle.close),
        ).pipe(Effect.provideService(Scope.Scope, owned));
        watches.set(repositoryId, owned);
      }).pipe(Effect.uninterruptible);

    return {
      watch: (repository) =>
        Effect.gen(function* () {
          if (closed || watches.has(repository.id)) return;
          const directory = yield* resolveGitCommonDirectory(
            git,
            repository.path,
          );
          if (closed || directory === undefined) return;
          yield* register(repository.id, directory);
        }).pipe(Semaphore.withPermit(mutex)),
    } satisfies RepositoryChangePublisher;
  });
}

function publishRepositoryChanges(
  pending: Queue.Queue<void>,
  changed: Set<string>,
  events: EnvironmentEventPublisher,
) {
  return Effect.gen(function* () {
    while (true) {
      yield* Queue.take(pending);
      yield* Effect.sleep(publishDelayMilliseconds);
      yield* Queue.clear(pending);
      const repositoryIds = [...changed];
      changed.clear();
      if (repositoryIds.length > 0) events.publishChanged(repositoryIds);
    }
  });
}

function resolveGitCommonDirectory(
  git: GitCommandRunner,
  repositoryPath: string,
) {
  return git
    .run({
      arguments: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      directory: repositoryPath,
      timeoutMilliseconds: 5_000,
    })
    .pipe(
      Effect.map((output) =>
        output.exitCode === 0 && output.stdout.trim().length > 0
          ? output.stdout.trim()
          : undefined,
      ),
      Effect.catch(() => Effect.succeed(undefined)),
    );
}
