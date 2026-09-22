import type {
  ChangesScope,
  RepositoryChanges,
} from "@rebase/contracts/repository-changes/repository-changes.contract";
import { Effect, Layer, Semaphore } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { GitCommands } from "#server/domain/git-command.contract";
import {
  RepositoryAccess,
  type RepositoryAccessService,
} from "#server/domain/repository-access.contract";
import type { RepositoryChangesService } from "#server/domain/repository-changes.contract";
import { RepositoryChangesAccess } from "#server/domain/repository-changes.contract";
import { safeChangePath } from "#server/features/repository-changes/git/change-files";
import {
  changeGit,
  changesError,
} from "#server/features/repository-changes/git/change-git";
import { withChangeIndex } from "#server/features/repository-changes/git/change-index";
import { mutateChanges } from "#server/features/repository-changes/git/mutate-changes";
import { readChangeDiff } from "#server/features/repository-changes/git/read-change-diff";
import { readChanges } from "#server/features/repository-changes/git/read-changes";
import { verifyChanges } from "#server/features/repository-changes/git/verify-changes";

export function createRepositoryChangesService(
  access: RepositoryAccessService,
  git: GitCommandRunner,
): RepositoryChangesService {
  const locks = new Map<string, Semaphore.Semaphore>();
  const locked = <A, E>(scope: ChangesScope, run: Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      yield* access
        .worktree(scope)
        .pipe(
          Effect.mapError((error) => changesError("Missing", error.detail)),
        );
      let lock = locks.get(scope.worktreePath);
      if (lock === undefined) {
        lock = yield* Semaphore.make(1);
        locks.set(scope.worktreePath, lock);
      }
      return yield* lock.withPermit(run);
    });
  return {
    read: (scope) =>
      locked(
        scope,
        readChanges(git, scope).pipe(
          Effect.map((value) => fitChanges(value.snapshot)),
        ),
      ),
    diff: (command) =>
      locked(
        command,
        Effect.gen(function* () {
          yield* safeChangePath(command.worktreePath, command.path);
          const { base } = yield* readChanges(git, command);
          return yield* readChangeDiff(git, command, base);
        }),
      ),
    mutate: (command) =>
      locked(
        command,
        Effect.gen(function* () {
          yield* withChangeIndex(git, command.worktreePath, (indexFile) =>
            Effect.gen(function* () {
              const { snapshot, base } = yield* verifyChanges(git, command);
              const indexedGit: GitCommandRunner = {
                run: (request) => git.run({ ...request, indexFile }),
              };
              yield* mutateChanges(
                indexedGit,
                command,
                snapshot,
                base,
                verifyChanges(git, command).pipe(Effect.asVoid),
              );
              if (command.action !== "discard")
                yield* verifyChanges(git, command);
            }),
          );
          return fitChanges((yield* readChanges(git, command)).snapshot);
        }),
      ),
    commit: (command) =>
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
              changeGit(
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
          Effect.andThen(() => readChanges(git, { ...command, amend: false })),
          Effect.map(({ snapshot }) => fitChanges(snapshot)),
        ),
      ),
  };
}

export const repositoryChangesLayer = Layer.effect(
  RepositoryChangesAccess,
  Effect.gen(function* () {
    return createRepositoryChangesService(
      yield* RepositoryAccess,
      yield* GitCommands,
    );
  }),
);

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
