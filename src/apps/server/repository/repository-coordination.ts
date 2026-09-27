import { realpath } from "node:fs/promises";
import {
  type RepositoryOperation,
  type RepositoryRejected,
  repositoryRejected,
} from "@rebase/contracts";
import { Effect, Option, Semaphore } from "effect";
import {
  type GitCommandRunner,
  readGitCommonDirectory,
  readGitEntryIdentity,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands";
import {
  type GitDirectories,
  readRepositoryOperation,
} from "#server/repository/repository-operation";

type RepositoryLockAcquisition = "wait" | "ifAvailable";

export interface RepositoryWritePolicy {
  readonly name: string;
  readonly locks: {
    readonly refs?: RepositoryLockAcquisition;
    readonly worktree?: RepositoryLockAcquisition;
  };
  readonly duringOperation:
    | "proceed"
    | "block"
    | { readonly allowWhen: (operation: RepositoryOperation) => boolean };
}

export interface RepositoryCoordination {
  readonly run: <A, E, R>(
    directory: string,
    policy: RepositoryWritePolicy,
    operation: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RepositoryRejected, R>;
  readonly operation: (
    directory: string,
  ) => Effect.Effect<RepositoryOperation, RepositoryRejected>;
}

export function createRepositoryCoordination(
  git: GitCommandRunner,
): RepositoryCoordination {
  const locks = new Map<
    string,
    { semaphore: Semaphore.Semaphore; owners: number }
  >();
  const withLock = <A, E, R>(
    key: string,
    acquisition: RepositoryLockAcquisition,
    operation: Effect.Effect<A, E, R>,
  ) =>
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
      (entry) =>
        acquisition === "wait"
          ? entry.semaphore.withPermit(operation)
          : entry.semaphore
              .withPermitsIfAvailable(1)(operation)
              .pipe(
                Effect.flatMap(
                  Option.match({
                    onSome: Effect.succeed,
                    onNone: () =>
                      Effect.fail(
                        repositoryRejected(
                          "Busy",
                          "Another repository write is in progress.",
                        ),
                      ),
                  }),
                ),
              ),
      (entry) =>
        Effect.sync(() => {
          if (--entry.owners === 0) {
            locks.delete(key);
          }
        }),
    );
  const directories = new Map<
    string,
    { readonly identity: string; readonly paths: GitDirectories }
  >();
  const gitDirectories = (directory: string) =>
    Effect.gen(function* () {
      const identity = yield* readGitEntryIdentity(directory);
      const cached = directories.get(directory);
      if (identity !== undefined && cached?.identity === identity)
        return cached.paths;
      const paths = yield* resolveGitDirectories(git, directory);
      if (identity !== undefined)
        directories.set(directory, { identity, paths });
      return paths;
    });
  const forgetOnError = <A, E, R>(
    directory: string,
    effect: Effect.Effect<A, E, R>,
  ) =>
    effect.pipe(
      Effect.onError(() => Effect.sync(() => directories.delete(directory))),
    );
  return {
    run: (directory, policy, operation) =>
      forgetOnError(
        directory,
        Effect.gen(function* () {
          const { refs, worktree } = policy.locks;
          const paths = yield* gitDirectories(directory);
          const guarded = requireCompatibleWrite(
            git,
            directory,
            paths,
            policy,
          ).pipe(Effect.andThen(operation));
          const inWorktree =
            worktree === undefined
              ? guarded
              : withLock(`worktree:${paths.gitDirectory}`, worktree, guarded);
          return yield* refs === undefined
            ? inWorktree
            : withLock(`refs:${paths.commonDirectory}`, refs, inWorktree);
        }),
      ),
    operation: (directory) =>
      forgetOnError(
        directory,
        gitDirectories(directory).pipe(
          Effect.flatMap((paths) =>
            readRepositoryOperation(git, directory, paths),
          ),
        ),
      ),
  };
}

function requireCompatibleWrite(
  git: GitCommandRunner,
  directory: string,
  paths: GitDirectories,
  { name, duringOperation }: RepositoryWritePolicy,
) {
  if (duringOperation === "proceed") return Effect.void;
  return readRepositoryOperation(git, directory, paths).pipe(
    Effect.flatMap((state) => {
      if (state.lock !== null)
        return Effect.fail(
          repositoryRejected("Busy", `Git lock exists: ${state.lock}.`),
        );
      if (
        state.kind === "idle" ||
        (duringOperation !== "block" && duringOperation.allowWhen(state))
      )
        return Effect.void;
      return Effect.fail(
        repositoryRejected(
          "Incompatible",
          `Cannot ${name} while ${state.kind === "unknown" ? "an unrecognized Git operation is" : `${state.kind} is`} in progress.`,
        ),
      );
    }),
  );
}

function resolveGitDirectories(
  git: GitCommandRunner,
  directory: string,
): Effect.Effect<GitDirectories, RepositoryRejected> {
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
        repositoryRejected(
          "GitFailed",
          "Could not resolve the worktree's Git directories.",
        ),
    });
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "GitFailed"
        ? repositoryRejected("GitFailed", error.detail)
        : error,
    ),
  );
}
