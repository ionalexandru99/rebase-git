import {
  type ChangesScope,
  type ChangesWritten,
  type CommitChanges,
  currentTransportLimits,
  type MutateChanges,
  type ReadChangeDiff,
  type RepositoryChanges,
  type ViewedChange,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryAccessService } from "#server/domain/repository-access.contract";
import type {
  RepositoryCoordinationError,
  RepositoryCoordinationService,
  RepositoryResourceScope,
} from "#server/domain/repository-coordination.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import {
  changesError,
  type RepositoryChangesError,
} from "#server/features/repository-changes/git/change-failures";
import { safeChangePath } from "#server/features/repository-changes/git/change-files";
import { withChangeIndex } from "#server/features/repository-changes/git/change-index";
import { mutateChanges } from "#server/features/repository-changes/git/mutate-changes";
import { readChangeDiff } from "#server/features/repository-changes/git/read-change-diff";
import { readChanges } from "#server/features/repository-changes/git/read-changes";
import {
  verifyChangedFiles,
  verifyChanges,
} from "#server/features/repository-changes/git/verify-changes";
import { runRepositoryGit } from "#server/repository/access/index";

export function createRepositoryChangesService(
  access: RepositoryAccessService,
  git: GitCommandRunner,
  coordination: RepositoryCoordinationService,
) {
  const inWorktree = <A>(
    scope: ChangesScope,
    run: Effect.Effect<
      A,
      RepositoryChangesError | RepositoryGitError | RepositoryCoordinationError
    >,
  ) =>
    access.requireWorktree(scope).pipe(
      Effect.mapError((error) => changesError("Missing", error.detail)),
      Effect.andThen(run),
      Effect.mapError((error) =>
        error._tag === "RepositoryChangesError"
          ? error
          : changesError("GitFailed", error.detail),
      ),
    );
  const locked = <A>(
    scope: ChangesScope,
    run: Effect.Effect<A, RepositoryChangesError | RepositoryGitError>,
    resources: RepositoryResourceScope = "worktree",
  ) => inWorktree(scope, coordination.run(scope.worktreePath, resources, run));
  return {
    read: (scope: ChangesScope) =>
      inWorktree(
        scope,
        readChanges(git, scope).pipe(
          Effect.map((value) => fitChanges(value.snapshot)),
        ),
      ),
    diff: (command: ReadChangeDiff) =>
      inWorktree(
        command,
        Effect.gen(function* () {
          yield* safeChangePath(command.worktreePath, command.path);
          const { base } = yield* readChanges(git, command);
          return yield* readChangeDiff(git, command, base);
        }),
      ),
    mutate: (command: MutateChanges) =>
      locked(
        command,
        Effect.gen(function* () {
          yield* withChangeIndex(git, command.worktreePath, (indexFile) =>
            Effect.gen(function* () {
              const current = yield* verifyChanges(git, command);
              const unchanged = verifyChangedFiles(
                command.worktreePath,
                current.files,
              );
              yield* mutateChanges(
                git,
                { indexFile },
                command,
                current,
                unchanged,
              );
              if (command.action !== "discard") yield* unchanged;
            }),
          );
          return yield* readWritten(git, command, command.viewed);
        }),
      ),
    commit: (command: CommitChanges) =>
      locked(
        command,
        withChangeIndex(git, command.worktreePath, (indexFile) =>
          Effect.gen(function* () {
            const { snapshot } = yield* verifyChanges(git, command);
            if (!command.message.trim())
              return yield* Effect.fail(
                changesError("Unsupported", "Write a commit message first."),
              );
            if (!command.amend && snapshot.staged.length === 0)
              return yield* Effect.fail(
                changesError("Unsupported", "Stage changes before committing."),
              );
            if (
              [...snapshot.unstaged, ...snapshot.staged].some(
                (file) => file.status === "U",
              )
            )
              return yield* Effect.fail(
                changesError(
                  "Conflict",
                  "Resolve all merge conflicts before committing.",
                ),
              );
            yield* Effect.uninterruptible(
              runRepositoryGit(
                git,
                command.worktreePath,
                [
                  "commit",
                  ...(command.amend ? ["--amend", "--allow-empty"] : []),
                  "--file=-",
                ],
                {
                  indexFile,
                  input: command.message,
                  timeoutMilliseconds: 120_000,
                },
              ),
            );
          }),
        ).pipe(
          Effect.andThen(() =>
            readWritten(git, { ...command, amend: false }, command.viewed),
          ),
        ),
        "worktree-and-refs",
      ),
  };
}

const writtenResponseBytes =
  currentTransportLimits.maxHttpResponseBytes - 32_768;

function readWritten(
  git: GitCommandRunner,
  scope: ChangesScope,
  viewed: ViewedChange | undefined,
) {
  return Effect.gen(function* () {
    const { snapshot, base } = yield* readChanges(git, scope);
    const changes = fitChanges(snapshot);
    const diff =
      viewed !== undefined &&
      snapshot[viewed.section].some((file) => file.path === viewed.path)
        ? yield* readChangeDiff(
            git,
            {
              repositoryId: scope.repositoryId,
              worktreePath: scope.worktreePath,
              amend: scope.amend,
              ...viewed,
            },
            base,
          ).pipe(Effect.catch(() => Effect.succeed(null)))
        : null;
    const written: ChangesWritten = { changes, diff };
    return Buffer.byteLength(JSON.stringify(written)) <= writtenResponseBytes
      ? written
      : { changes, diff: null };
  });
}

function fitChanges(snapshot: RepositoryChanges): RepositoryChanges {
  let size = 0;
  const fit = (files: RepositoryChanges["staged"]) =>
    files.filter((file) => {
      size += Buffer.byteLength(JSON.stringify(file));
      return size < 800_000;
    });
  const unstaged = fit(snapshot.unstaged),
    staged = fit(snapshot.staged);
  return {
    ...snapshot,
    unstaged,
    staged,
    truncated:
      unstaged.length !== snapshot.unstaged.length ||
      staged.length !== snapshot.staged.length,
  };
}
