import { realpath } from "node:fs/promises";
import { Effect, Layer, Option, Semaphore } from "effect";
import {
  type GitCommandRunner,
  GitCommands,
} from "#server/domain/git-command.contract";
import {
  RepositoryCoordination,
  RepositoryCoordinationError,
  type RepositoryCoordinationService,
  type RepositoryWrite,
} from "#server/domain/repository-coordination.contract";
import { readGitCommonDirectory } from "#server/repository/access/git/read-git-common-directory";
import { readGitEntryIdentity } from "#server/repository/access/git/read-git-entry-identity";
import { runRepositoryGit } from "#server/repository/access/run-repository-git";
import {
  type GitDirectories,
  readRepositoryOperation,
} from "#server/repository/operation/index";

const worktreeWrites: readonly RepositoryWrite[] = [
  "checkout",
  "pull",
  "stage",
  "unstage",
  "discard",
  "commit",
  "amend",
  "recover",
];
const refWrites: readonly RepositoryWrite[] = [
  "checkout",
  "fetch",
  "pull",
  "push",
  "commit",
  "amend",
  "recover",
];

export function createRepositoryCoordination(
  git: GitCommandRunner,
): RepositoryCoordinationService {
  const locks = new Map<
    string,
    { semaphore: Semaphore.Semaphore; owners: number }
  >();
  const withLock = <A, E, R>(
    key: string,
    operation: Effect.Effect<A, E, R>,
    waitForPermit = true,
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
        waitForPermit
          ? entry.semaphore.withPermit(operation)
          : entry.semaphore
              .withPermitsIfAvailable(1)(operation)
              .pipe(
                Effect.flatMap(
                  Option.match({
                    onSome: Effect.succeed,
                    onNone: () =>
                      Effect.fail(
                        new RepositoryCoordinationError({
                          reason: "Busy",
                          detail: "Another repository write is in progress.",
                        }),
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
    run: (directory, write, operation) =>
      forgetOnError(
        directory,
        Effect.gen(function* () {
          const paths = yield* gitDirectories(directory);
          const guarded = requireCompatibleWrite(
            git,
            directory,
            paths,
            write,
          ).pipe(Effect.andThen(operation));
          const worktree = worktreeWrites.includes(write)
            ? withLock(`worktree:${paths.gitDirectory}`, guarded)
            : guarded;
          return yield* refWrites.includes(write)
            ? withLock(
                `refs:${paths.commonDirectory}`,
                worktree,
                write !== "fetch",
              )
            : worktree;
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
  write: RepositoryWrite,
) {
  if (write === "fetch" || write === "push" || write === "recover")
    return Effect.void;
  return readRepositoryOperation(git, directory, paths).pipe(
    Effect.flatMap((state) => {
      if (state.lock !== null)
        return Effect.fail(
          new RepositoryCoordinationError({
            reason: "Busy",
            detail: `Git lock exists: ${state.lock}.`,
          }),
        );
      if (
        state.kind === "idle" ||
        (state.kind !== "unknown" &&
          (write === "stage" || write === "unstage")) ||
        (write === "amend" && state.kind === "rebase" && state.phase === "edit")
      )
        return Effect.void;
      return Effect.fail(
        new RepositoryCoordinationError({
          reason: "Incompatible",
          detail: `Cannot ${write} while ${state.kind === "unknown" ? "an unrecognized Git operation is" : `${state.kind} is`} in progress.`,
        }),
      );
    }),
  );
}

function resolveGitDirectories(
  git: GitCommandRunner,
  directory: string,
): Effect.Effect<GitDirectories, RepositoryCoordinationError> {
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
          reason: "Unavailable",
          detail: "Could not resolve the worktree's Git directories.",
        }),
    });
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "RepositoryGitError"
        ? new RepositoryCoordinationError({
            reason: "Unavailable",
            detail: error.detail,
          })
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
