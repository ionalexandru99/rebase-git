import { Effect, type Scope } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryChangePublisher } from "#server/domain/repository-refs.contract";
import type {
  RepositoryWatcher,
  RepositoryWatchHandle,
} from "#server/domain/repository-watcher.contract";
import type { EnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher.contract";

const maximumWatchedRepositories = 32;
const publishDelayMilliseconds = 150;

export function acquireRepositoryChangePublisher(
  git: GitCommandRunner,
  watcher: RepositoryWatcher,
  events: EnvironmentEventPublisher,
): Effect.Effect<RepositoryChangePublisher, never, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.sync(() => createRepositoryChangePublisher(git, watcher, events)),
    (publisher) => Effect.sync(publisher.close),
  );
}

function createRepositoryChangePublisher(
  git: GitCommandRunner,
  watcher: RepositoryWatcher,
  events: EnvironmentEventPublisher,
) {
  const handles = new Map<string, RepositoryWatchHandle>();
  const pending = new Set<string>();
  let publishTimer: NodeJS.Timeout | undefined;

  const publishSoon = () => {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publishTimer = undefined;
      events.publishChanged();
    }, publishDelayMilliseconds);
    publishTimer.unref();
  };

  const watch = (repositoryPath: string) =>
    Effect.gen(function* () {
      if (handles.has(repositoryPath) || pending.has(repositoryPath)) return;
      pending.add(repositoryPath);
      const gitDirectory = yield* resolveGitCommonDirectory(
        git,
        repositoryPath,
      );
      if (gitDirectory !== undefined) {
        evictOldestWatch(handles);
        handles.set(
          repositoryPath,
          yield* watcher.watch(gitDirectory, publishSoon),
        );
      }
      pending.delete(repositoryPath);
    });

  return {
    close: () => {
      clearTimeout(publishTimer);
      for (const handle of handles.values()) handle.close();
      handles.clear();
    },
    watch,
  } satisfies RepositoryChangePublisher & { readonly close: () => void };
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

function evictOldestWatch(handles: Map<string, RepositoryWatchHandle>) {
  if (handles.size < maximumWatchedRepositories) return;
  const oldest = handles.entries().next().value;
  if (oldest === undefined) return;
  oldest[1].close();
  handles.delete(oldest[0]);
}
