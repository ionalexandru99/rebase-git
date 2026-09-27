import {
  type ExecuteOperation,
  type OperationFailure,
  type RepositoryOperation,
  RepositoryOperationsHttpApi,
  repositoryRejected,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/combine-environment-features";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/http/repository-http-routes";
import type {
  GitCommandOutput,
  GitCommandRunner,
} from "#server/adapters/local-git/git-commands";
import type { RepositoryCoordination } from "#server/repository/repository-coordination";

export function repositoryOperationsFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const { coordination } = dependencies;
  const api = RepositoryOperationsHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      query(api.read, (input) => coordination.operation(input.worktreePath)),
      command(
        api.execute,
        {
          name: "recover",
          locks: { refs: "wait", worktree: "wait" },
          duringOperation: "proceed",
        },
        (input, git) => recoverRepositoryOperation(git, coordination, input),
      ),
    ],
  };
}

function recoverRepositoryOperation(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  command: ExecuteOperation,
) {
  return Effect.gen(function* () {
    const state = yield* coordination.operation(command.worktreePath);
    yield* validateRecoveryAction(state, command);
    const output = yield* git
      .run({
        directory: command.worktreePath,
        arguments: [state.kind, `--${command.action}`],
        timeoutMilliseconds: 120_000,
      })
      .pipe(
        Effect.mapError(() =>
          operationError(
            "Uncertain",
            "Git's result could not be confirmed. Refresh the worktree before trying again.",
          ),
        ),
      );
    const operation = yield* coordination
      .operation(command.worktreePath)
      .pipe(
        Effect.mapError(() =>
          operationError(
            "Uncertain",
            "Git finished, but its current state could not be read.",
          ),
        ),
      );
    if (command.action === "abort" || !advancedToConflict(state, operation))
      yield* requireRecoverySuccess(output);
    return operation;
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
  if (action?.enabled) return Effect.void;
  const detail =
    action?.reason ?? "This action is not supported by the current Git state.";
  return Effect.fail(
    state.lock
      ? repositoryRejected("Busy", detail)
      : operationError("Incompatible", detail),
  );
}

function requireRecoverySuccess(output: GitCommandOutput) {
  if (output.exitCode === 0) return Effect.void;
  const detail =
    output.stderr ||
    output.stdout ||
    "Git rejected the action. Check the worktree and configured hooks.";
  if (/\.lock['\s:]|another git process/i.test(detail))
    return Effect.fail(repositoryRejected("Busy", detail));
  return Effect.fail(
    operationError(
      /hook|pre-commit|commit-msg|pre-rebase/i.test(detail)
        ? "HookFailed"
        : "GitRejected",
      detail,
    ),
  );
}

function operationError(
  reason: OperationFailure["reason"],
  detail: string,
): OperationFailure {
  return { _tag: "OperationFailed", reason, detail: detail.slice(0, 2048) };
}
