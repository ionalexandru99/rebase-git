import { Effect, Result } from "effect";
import type {
  MergeMode,
  OperationStarted,
  RepositoryOperation,
  StartMerge,
  StartOperation,
  StartRebase,
  StartRevert,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import { startCherryPick } from "#server/features/repository-operations/cherry-pick.ts";
import {
  type GitExit,
  hasStagedChanges,
  headMoved,
  operationFailure,
  readCommit,
  requireGitSuccess,
  requireLanded,
  runChange,
  started,
} from "#server/features/repository-operations/operation-outcome.ts";
import { rebasePlanTodo } from "#server/features/repository-operations/rebase-plan.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

export function startOperation(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  command: StartOperation,
) {
  const { operation } = command;
  switch (operation._tag) {
    case "Merge":
      return mergeSource(git, coordination, command, operation, false).pipe(
        Effect.map(({ started }) => started),
      );
    case "Rebase":
      return rebaseOnto(git, coordination, command, operation, true).pipe(
        Effect.flatMap(({ started, autostashConflict }) =>
          autostashConflict === undefined
            ? Effect.succeed(started)
            : operationFailure("GitRejected", autostashConflict),
        ),
      );
    case "Revert":
      return revertCommits(git, coordination, command, operation);
    case "CherryPick":
      return startCherryPick(git, coordination, command, operation);
  }
}

const mergeArguments: Readonly<Record<MergeMode, readonly string[]>> = {
  merge: ["--ff", "--no-edit"],
  "ff-only": ["--ff-only"],
  "no-ff": ["--no-ff", "--no-edit"],
  squash: ["--squash"],
};

type Expected = Pick<StartOperation, "worktreePath" | "expectedHead">;

export interface Integrated {
  readonly started: OperationStarted;
  readonly autostashConflict: string | undefined;
}

function integrated(
  outcome: OperationStarted["outcome"],
  operation: RepositoryOperation,
  exit?: GitExit,
): Integrated {
  const output = exit === undefined ? undefined : Result.getOrUndefined(exit);
  const text = output === undefined ? "" : `${output.stderr}${output.stdout}`;
  return {
    started: started(outcome, operation),
    autostashConflict: /resulted in conflicts/.test(text) ? text : undefined,
  };
}

export function mergeSource(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  { worktreePath: directory, expectedHead }: Expected,
  { source, mode }: StartMerge,
  autostash: boolean,
) {
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
      return integrated("UpToDate", yield* coordination.operation(directory));
    if (mode === "ff-only" && base.trim() !== head)
      return yield* operationFailure(
        "NotFastForward",
        `Can't fast-forward to ${revision}.`,
      );
    const exit = yield* runChange(git, {
      directory,
      arguments: [
        "merge",
        autostash ? "--autostash" : "--no-autostash",
        "--no-stat",
        ...mergeArguments[mode],
        "--end-of-options",
        revision,
      ],
      timeoutMilliseconds: 120_000,
    });
    const state = yield* coordination.operation(directory);
    if (state.phase === "conflicts") return integrated("Stopped", state);
    if (mode === "squash") {
      yield* requireLanded(exit, hasStagedChanges(git, directory));
      return integrated("Staged", state, exit);
    }
    const merged = yield* readCommit(git, directory, "HEAD");
    yield* requireLanded(exit, Effect.succeed(merged !== head));
    return integrated(
      merged === head
        ? "UpToDate"
        : merged === source.commit
          ? "FastForwarded"
          : "Committed",
      state,
      exit,
    );
  });
}

export function rebaseOnto(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  { worktreePath: directory, expectedHead }: Expected,
  { onto, stash, plan }: StartRebase,
  keepMerges: boolean,
) {
  const revision = onto.ref ?? onto.commit;
  return Effect.gen(function* () {
    const [head, branch, target, changes, merges] = yield* Effect.all(
      [
        readCommit(git, directory, "HEAD"),
        onBranch(git, directory),
        readCommit(git, directory, revision),
        runRepositoryGit(
          git,
          directory,
          ["status", "--porcelain=v1", "-z", "--untracked-files=no"],
          { globalArguments: ["--no-optional-locks"] },
        ),
        keepMerges && plan === undefined
          ? runRepositoryGit(
              git,
              directory,
              [
                "rev-list",
                "--merges",
                "--max-count=1",
                `${onto.commit}..${expectedHead}`,
              ],
              { exitCodes: [0, 128] },
            )
          : Effect.succeed(""),
      ],
      { concurrency: "unbounded" },
    );
    if (head !== expectedHead)
      return yield* operationFailure("Stale", "HEAD moved. Try again.");
    if (!branch)
      return yield* operationFailure("Incompatible", "HEAD is detached.");
    if (target !== onto.commit)
      return yield* operationFailure("Stale", `${revision} moved. Try again.`);
    if (changes.length > 0 && !stash)
      return yield* operationFailure(
        "Stale",
        "Files changed in the worktree. Try again.",
      );
    const todo =
      plan === undefined
        ? undefined
        : yield* rebasePlanTodo(
            git,
            directory,
            `${onto.commit}..${expectedHead}`,
            plan,
          );
    const exit = yield* runChange(git, {
      directory,
      ...(todo === undefined
        ? {}
        : { globalArguments: ["-c", "sequence.editor=cat >"], input: todo }),
      arguments: [
        "rebase",
        ...(todo === undefined ? [] : ["--interactive", "--empty=drop"]),
        merges.length > 0 ? "--rebase-merges" : "--no-rebase-merges",
        stash ? "--autostash" : "--no-autostash",
        "--end-of-options",
        revision,
      ],
      timeoutMilliseconds: 600_000,
    });
    const state = yield* coordination.operation(directory);
    if (state.kind === "rebase") return integrated("Stopped", state);
    const rebased = yield* readCommit(git, directory, "HEAD");
    yield* requireLanded(exit, Effect.succeed(rebased !== head));
    return integrated(
      rebased === head
        ? "UpToDate"
        : rebased === onto.commit
          ? "FastForwarded"
          : "Rebased",
      state,
      exit,
    );
  });
}

function revertCommits(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  { worktreePath: directory, expectedHead }: StartOperation,
  { commits, commit }: StartRevert,
) {
  return Effect.gen(function* () {
    if ((yield* readCommit(git, directory, "HEAD")) !== expectedHead)
      return yield* operationFailure("Stale", "HEAD moved. Try again.");
    const outside = yield* runRepositoryGit(git, directory, [
      "rev-list",
      ...commits,
      "--not",
      "HEAD",
    ]);
    const foreign = commits.find((oid) => outside.includes(oid));
    if (foreign !== undefined)
      return yield* operationFailure(
        "Incompatible",
        `${foreign.slice(0, 8)} is not in the checked-out branch.`,
      );
    const exit = yield* runChange(git, {
      directory,
      arguments: [
        "revert",
        "--no-edit",
        "--mainline",
        "1",
        ...(commit ? [] : ["--no-commit"]),
        ...commits,
      ],
      timeoutMilliseconds: 120_000,
    });
    const state = yield* coordination.operation(directory);
    const outcome = commit ? "Committed" : "Staged";
    if (Result.isFailure(exit)) {
      if (state.kind === "revert") return started("Stopped", state);
      yield* requireLanded(exit, headMoved(git, directory, expectedHead));
      return started(outcome, state);
    }
    const output = exit.success;
    const empty = /nothing to commit/i.test(
      `${output.stdout}\n${output.stderr}`,
    );
    if (output.exitCode === 0) return started(outcome, state);
    if (state.kind === "revert" && (state.phase === "conflicts" || empty))
      return started("Stopped", state);
    if (empty)
      return yield* operationFailure(
        "Empty",
        "Nothing to revert. The changes are already undone.",
      );
    yield* requireGitSuccess(output);
    return started("Stopped", state);
  });
}

function onBranch(git: GitCommandRunner, directory: string) {
  return runRepositoryGitOutput(
    git,
    directory,
    ["symbolic-ref", "--quiet", "HEAD"],
    { exitCodes: [0, 1] },
  ).pipe(Effect.map((output) => output.exitCode === 0));
}
