import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  type ExecuteOperation,
  type MergeMode,
  type OperationFailure,
  type OperationStarted,
  type RepositoryOperation,
  RepositoryOperationsApi,
  type StartOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandOutput,
  type GitCommandRunner,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
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
        (input, git) => startMerge(git, coordination, input),
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
        arguments:
          state.kind === "squash"
            ? ["reset", "--merge"]
            : [state.kind, `--${command.action}`],
        timeoutMilliseconds: 120_000,
      })
      .pipe(Effect.mapError(uncertain));
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
      yield* requireGitSuccess(output);
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

const mergeArguments: Readonly<Record<MergeMode, readonly string[]>> = {
  merge: ["--ff", "--no-edit"],
  "ff-only": ["--ff-only"],
  "no-ff": ["--no-ff", "--no-edit"],
  squash: ["--squash"],
};

function startMerge(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  { worktreePath: directory, expectedHead, operation }: StartOperation,
) {
  const { source, mode } = operation;
  const revision = source.ref ?? source.commit;
  return Effect.gen(function* () {
    const head = yield* readCommit(git, directory, "HEAD");
    if (head !== expectedHead)
      return yield* operationFailure("Stale", "HEAD moved. Try again.");
    if (!(yield* onBranch(git, directory)))
      return yield* operationFailure("Incompatible", "HEAD is detached.");
    if ((yield* readCommit(git, directory, revision)) !== source.commit)
      return yield* operationFailure("Stale", `${revision} moved. Try again.`);
    const base = yield* runRepositoryGit(
      git,
      directory,
      ["merge-base", head, source.commit],
      { exitCodes: [0, 1] },
    );
    if (base.trim() === "")
      return yield* operationFailure(
        "Unrelated",
        `${revision} has no history in common with the current branch.`,
      );
    if (base.trim() === source.commit)
      return started("UpToDate", yield* coordination.operation(directory));
    if (mode === "ff-only" && base.trim() !== head)
      return yield* operationFailure(
        "NotFastForward",
        `Can't fast-forward to ${revision}.`,
      );
    const output = yield* git
      .run({
        directory,
        arguments: [
          "merge",
          "--no-autostash",
          "--no-stat",
          ...mergeArguments[mode],
          "--end-of-options",
          revision,
        ],
        timeoutMilliseconds: 120_000,
      })
      .pipe(Effect.mapError(uncertain), Effect.uninterruptible);
    const state = yield* coordination.operation(directory);
    if (state.phase === "conflicts") return started("Stopped", state);
    yield* requireGitSuccess(output);
    if (mode === "squash") return started("Staged", state);
    const merged = yield* readCommit(git, directory, "HEAD");
    return started(
      merged === head
        ? "UpToDate"
        : merged === source.commit
          ? "FastForwarded"
          : "Committed",
      state,
    );
  });
}

function started(
  outcome: OperationStarted["outcome"],
  operation: RepositoryOperation,
): OperationStarted {
  return { outcome, operation };
}

function readCommit(git: GitCommandRunner, directory: string, rev: string) {
  return runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`],
    { exitCodes: [0, 1] },
  ).pipe(Effect.map((output) => output.trim()));
}

function onBranch(git: GitCommandRunner, directory: string) {
  return runRepositoryGitOutput(
    git,
    directory,
    ["symbolic-ref", "--quiet", "HEAD"],
    { exitCodes: [0, 1] },
  ).pipe(Effect.map((output) => output.exitCode === 0));
}

function requireGitSuccess(output: GitCommandOutput) {
  if (output.exitCode === 0) return Effect.void;
  const detail =
    output.stderr ||
    output.stdout ||
    "Git rejected the action. Check the worktree and configured hooks.";
  if (/\.lock['\s:]|another git process/i.test(detail))
    return Effect.fail(repositoryRejected("Busy", detail));
  if (/would be overwritten by merge/i.test(detail))
    return Effect.fail({
      ...operationError("WouldOverwrite", detail),
      paths: detail
        .split("\n")
        .filter((line) => line.startsWith("\t"))
        .map((line) => line.trim())
        .filter((path) => path.length > 0)
        .slice(0, 100),
    });
  return Effect.fail(
    operationError(
      /hook|pre-commit|commit-msg|pre-rebase|not committing merge/i.test(detail)
        ? "HookFailed"
        : "GitRejected",
      detail,
    ),
  );
}

function uncertain() {
  return operationError(
    "Uncertain",
    "Git's result could not be confirmed. Refresh the worktree before trying again.",
  );
}

function operationFailure(reason: OperationFailure["reason"], detail: string) {
  return Effect.fail(operationError(reason, detail));
}

function operationError(
  reason: OperationFailure["reason"],
  detail: string,
): OperationFailure {
  return { _tag: "OperationFailed", reason, detail: detail.slice(0, 2048) };
}
