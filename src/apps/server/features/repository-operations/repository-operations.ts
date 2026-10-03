import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type ExecuteOperation,
  type RepositoryOperation,
  RepositoryOperationsApi,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { continueStagedCherryPick } from "#server/features/repository-operations/cherry-pick.ts";
import {
  operationError,
  requireLanded,
  runChange,
} from "#server/features/repository-operations/operation-outcome.ts";
import { startOperation } from "#server/features/repository-operations/start-operation.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

export function repositoryOperationsFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const { coordination } = dependencies;
  const api = RepositoryOperationsApi;
  return {
    routes: [
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
      command(
        api.start,
        (input) => ({
          name: input.operation._tag.toLowerCase(),
          locks: { refs: "wait", worktree: "wait" },
          duringOperation: "block",
        }),
        (input, git) => startOperation(git, coordination, input),
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
    if (
      state.kind === "cherry-pick" &&
      command.action === "continue" &&
      (yield* continueStagedCherryPick(git, command.worktreePath))
    )
      return yield* coordination.operation(command.worktreePath);
    const exit = yield* runChange(git, {
      directory: command.worktreePath,
      arguments:
        state.kind === "squash"
          ? ["reset", "--merge"]
          : [state.kind, `--${command.action}`],
      timeoutMilliseconds: 120_000,
    });
    const operation = yield* coordination.operation(command.worktreePath);
    if (command.action !== "abort" && advancedToStop(state, operation))
      return operation;
    yield* requireLanded(
      exit,
      Effect.succeed(
        operation.kind === "idle" ||
          (command.action !== "abort" && advanced(state, operation)),
      ),
    );
    return operation;
  }).pipe(Effect.uninterruptible);
}

function advancedToStop(
  previous: RepositoryOperation,
  current: RepositoryOperation,
) {
  return (
    (current.phase === "conflicts" || current.phase === "empty") &&
    advanced(previous, current)
  );
}

function advanced(previous: RepositoryOperation, current: RepositoryOperation) {
  return (
    current.kind === previous.kind &&
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
