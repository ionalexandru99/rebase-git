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
import { changesError } from "#server/features/repository-changes/git/change-failures";
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

export function readRepositoryChanges(
  scope: ChangesScope,
  git: GitCommandRunner,
) {
  return readChanges(git, scope).pipe(
    Effect.map((value) => fitChanges(value.snapshot)),
  );
}

export function readRepositoryChangeDiff(
  command: ReadChangeDiff,
  git: GitCommandRunner,
) {
  return Effect.gen(function* () {
    yield* safeChangePath(command.worktreePath, command.path);
    const { snapshot, base } = yield* readChanges(git, command);
    return yield* readChangeDiff(git, command, {
      base,
      previousPath: previousPathOf(snapshot, command),
    });
  });
}

export function mutateRepositoryChanges(
  command: MutateChanges,
  git: GitCommandRunner,
) {
  return Effect.gen(function* () {
    yield* withChangeIndex(git, command.worktreePath, (indexFile) =>
      Effect.gen(function* () {
        const current = yield* verifyChanges(git, command);
        const unchanged = verifyChangedFiles(
          command.worktreePath,
          current.files,
        );
        yield* mutateChanges(git, { indexFile }, command, current, unchanged);
        if (command.action !== "discard") yield* unchanged;
      }),
    );
    return yield* readWritten(git, command, command.viewed);
  });
}

export function commitRepositoryChanges(
  command: CommitChanges,
  git: GitCommandRunner,
) {
  return withChangeIndex(git, command.worktreePath, (indexFile) =>
    Effect.gen(function* () {
      const { snapshot } = yield* verifyChanges(git, command);
      yield* requireCommittable(command, snapshot);
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
  );
}

function requireCommittable(
  command: CommitChanges,
  snapshot: RepositoryChanges,
) {
  if (!command.message.trim())
    return Effect.fail(
      changesError("Unsupported", "Write a commit message first."),
    );
  if (!command.amend && snapshot.staged.length === 0)
    return Effect.fail(
      changesError("Unsupported", "Stage changes before committing."),
    );
  if (
    [...snapshot.unstaged, ...snapshot.staged].some(
      (file) => file.status === "U",
    )
  )
    return Effect.fail(
      changesError(
        "Conflict",
        "Resolve all merge conflicts before committing.",
      ),
    );
  return Effect.void;
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
    const file =
      viewed &&
      snapshot[viewed.section].find((file) => file.path === viewed.path);
    const diff =
      viewed && file
        ? yield* readChangeDiff(
            git,
            {
              repositoryId: scope.repositoryId,
              worktreePath: scope.worktreePath,
              amend: scope.amend,
              ...viewed,
            },
            { base, previousPath: file.previousPath },
          ).pipe(Effect.catch(() => Effect.succeed(null)))
        : null;
    const written: ChangesWritten = { changes, diff };
    return Buffer.byteLength(JSON.stringify(written)) <= writtenResponseBytes
      ? written
      : { changes, diff: null };
  });
}

function previousPathOf(snapshot: RepositoryChanges, viewed: ViewedChange) {
  return (
    snapshot[viewed.section].find((file) => file.path === viewed.path)
      ?.previousPath ?? null
  );
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
