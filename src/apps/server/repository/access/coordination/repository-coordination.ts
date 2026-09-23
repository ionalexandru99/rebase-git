import { realpath } from "node:fs/promises";
import { Effect, Layer, Semaphore } from "effect";
import {
  type GitCommandRunner,
  GitCommands,
} from "#server/domain/git-command.contract";
import {
  RepositoryCoordination,
  RepositoryCoordinationError,
  type RepositoryCoordinationService,
} from "#server/domain/repository-coordination.contract";
import { readGitCommonDirectory } from "#server/repository/access/git/read-git-common-directory";
import { runRepositoryGit } from "#server/repository/access/run-repository-git";

export function createRepositoryCoordination(
  git: GitCommandRunner,
): RepositoryCoordinationService {
  const locks = new Map<
    string,
    { semaphore: Semaphore.Semaphore; owners: number }
  >();
  const withLock = <A, E, R>(key: string, operation: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        let entry = locks.get(key);
        if (entry === undefined) {
          entry = { semaphore: Semaphore.makeUnsafe(1), owners: 0 };
          locks.set(key, entry);
        }
        entry.owners++;
        return entry;
      }),
      (entry) => entry.semaphore.withPermit(operation),
      (entry) =>
        Effect.sync(() => {
          if (--entry.owners === 0) {
            locks.delete(key);
          }
        }),
    );
  return {
    run: (directory, scope, operation) =>
      Effect.gen(function* () {
        const paths = yield* resolveGitDirectories(git, directory);
        const worktree =
          scope === "refs"
            ? operation
            : withLock(`worktree:${paths.gitDirectory}`, operation);
        return yield* scope !== "worktree"
          ? withLock(`refs:${paths.commonDirectory}`, worktree)
          : worktree;
      }),
  };
}

function resolveGitDirectories(git: GitCommandRunner, directory: string) {
  return Effect.gen(function* () {
    const gitDirectory = (yield* runRepositoryGit(git, directory, [
      "rev-parse",
      "--absolute-git-dir",
    ])).trimEnd();
    const commonDirectory = yield* readGitCommonDirectory(git, directory);
    return yield* Effect.tryPromise({
      try: async () => ({
        gitDirectory: await realpath(gitDirectory),
        commonDirectory: await realpath(commonDirectory),
      }),
      catch: () =>
        new RepositoryCoordinationError({
          detail: "Could not resolve the worktree's Git directories.",
        }),
    });
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "RepositoryGitError"
        ? new RepositoryCoordinationError({ detail: error.detail })
        : error,
    ),
  );
}

export const repositoryCoordinationLayer = Layer.effect(
  RepositoryCoordination,
  Effect.gen(function* () {
    return createRepositoryCoordination(yield* GitCommands);
  }),
);
