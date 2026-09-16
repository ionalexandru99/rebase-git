import type {
  ExecuteOperation,
  RepositoryOperation,
} from "@rebase/contracts/repository-operations/repository-operations.contract";
import { Effect } from "effect";
import type {
  GitCommandOutput,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import {
  operationError,
  recoveryInvalidation,
} from "#server/features/repository-operations/git/operation-errors";
import { readRepositoryOperation } from "#server/features/repository-operations/git/read-operation";

export function recoverRepositoryOperation(
  git: GitCommandRunner,
  command: ExecuteOperation,
) {
  return Effect.gen(function* () {
    const state = yield* readRepositoryOperation(git, command.worktreePath);
    yield* validateRecoveryAction(state, command);
    const output = yield* git
      .run({
        directory: command.worktreePath,
        arguments: [
          "-c",
          "core.editor=true",
          state.kind,
          `--${command.action}`,
        ],
        timeoutMilliseconds: 120_000,
      })
      .pipe(
        Effect.mapError(() =>
          operationError(
            "Uncertain",
            "Git's result could not be confirmed. Refresh the worktree before trying again.",
            recoveryInvalidation,
          ),
        ),
      );
    const operation = yield* readRepositoryOperation(
      git,
      command.worktreePath,
    ).pipe(
      Effect.mapError(() =>
        operationError(
          "Uncertain",
          "Git finished, but its current state could not be read.",
          recoveryInvalidation,
        ),
      ),
    );
    if (command.action === "abort" || !advancedToConflict(state, operation))
      yield* requireRecoverySuccess(output);
    return { operation, invalidation: recoveryInvalidation };
  }).pipe(Effect.uninterruptible);
}

function advancedToConflict(
  previous: RepositoryOperation,
  current: RepositoryOperation,
) {
  return (
    current.kind === previous.kind &&
    current.phase === "conflicts" &&
    ((current.commit !== null && current.commit !== previous.commit) ||
      (current.progress !== null &&
        previous.progress !== null &&
        current.progress.current > previous.progress.current))
  );
}

function validateRecoveryAction(
  state: RepositoryOperation,
  command: ExecuteOperation,
) {
  if (state.revision !== command.revision)
    return Effect.fail(
      operationError(
        "Stale",
        "Git state changed. Review the refreshed operation before trying again.",
      ),
    );
  const action = state.actions.find(
    (candidate) => candidate.action === command.action,
  );
  return action?.enabled
    ? Effect.void
    : Effect.fail(
        operationError(
          state.lock ? "Locked" : "Incompatible",
          action?.reason ??
            "This action is not supported by the current Git state.",
        ),
      );
}

function requireRecoverySuccess(output: GitCommandOutput) {
  if (output.exitCode === 0) return Effect.void;
  const detail =
    output.stderr ||
    output.stdout ||
    "Git rejected the action. Check the worktree and configured hooks.";
  const reason = /\.lock['\s:]|another git process/i.test(detail)
    ? "Locked"
    : /hook|pre-commit|commit-msg|pre-rebase/i.test(detail)
      ? "HookFailed"
      : "GitRejected";
  return Effect.fail(operationError(reason, detail, recoveryInvalidation));
}
