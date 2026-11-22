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
  operationError,
  readCommit,
  requireGitSuccess,
  requireLanded,
  runChange,
  started,
} from "#server/features/repository-operations/operation-outcome.ts";
import { rebasePlanTodo } from "#server/features/repository-operations/rebase-plan.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

export async function startOperation(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  command: StartOperation,
) {
  const { operation } = command;
  switch (operation._tag) {
    case "Merge":
      return (await mergeSource(git, coordination, command, operation, false))
        .started;
    case "Rebase": {
      const { started, autostashConflict } = await rebaseOnto(
        git,
        coordination,
        command,
        operation,
        true,
      );
      if (autostashConflict !== undefined)
        throw operationError("GitRejected", autostashConflict);
      return started;
    }
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
  const output = exit?._tag === "Success" ? exit.output : undefined;
  const text = output === undefined ? "" : `${output.stderr}${output.stdout}`;
  return {
    started: started(outcome, operation),
    autostashConflict: /resulted in conflicts|safe in the stash/.test(text)
      ? text
      : undefined,
  };
}

export async function mergeSource(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  { worktreePath: directory, expectedHead }: Expected,
  { source, mode }: StartMerge,
  autostash: boolean,
): Promise<Integrated> {
  const revision = source.ref ?? source.commit;
  const head = await readCommit(git, directory, "HEAD");
  if (head !== expectedHead)
    throw operationError("Stale", "HEAD moved. Try again.");
  if (!(await onBranch(git, directory)))
    throw operationError("Incompatible", "HEAD is detached.");
  if ((await readCommit(git, directory, revision)) !== source.commit)
    throw operationError("Stale", `${revision} moved. Try again.`);
  const base = await runRepositoryGit(
    git,
    directory,
    ["merge-base", head, source.commit],
    { exitCodes: [0, 1] },
  );
  if (base.trim() === "")
    throw operationError(
      "Unrelated",
      `${revision} has no history in common with the current branch.`,
    );
  if (base.trim() === source.commit)
    return integrated("UpToDate", await coordination.operation(directory));
  if (mode === "ff-only" && base.trim() !== head)
    throw operationError(
      "NotFastForward",
      `Can't fast-forward to ${revision}.`,
    );
  const exit = await runChange(git, {
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
  const state = await coordination.operation(directory);
  if (state.phase === "conflicts") return integrated("Stopped", state);
  if (mode === "squash") {
    await requireLanded(exit, () => hasStagedChanges(git, directory));
    return integrated("Staged", state, exit);
  }
  const merged = await readCommit(git, directory, "HEAD");
  await requireLanded(exit, async () => merged !== head);
  return integrated(
    merged === head
      ? "UpToDate"
      : merged === source.commit
        ? "FastForwarded"
        : "Committed",
    state,
    exit,
  );
}

export async function rebaseOnto(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  { worktreePath: directory, expectedHead }: Expected,
  { onto, stash, plan }: StartRebase,
  keepMerges: boolean,
): Promise<Integrated> {
  const revision = onto.ref ?? onto.commit;
  const [head, branch, target, changes, merges] = await Promise.all([
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
      : "",
  ]);
  if (head !== expectedHead)
    throw operationError("Stale", "HEAD moved. Try again.");
  if (!branch) throw operationError("Incompatible", "HEAD is detached.");
  if (target !== onto.commit)
    throw operationError("Stale", `${revision} moved. Try again.`);
  if (changes.length > 0 && !stash)
    throw operationError("Stale", "Files changed in the worktree. Try again.");
  const todo =
    plan === undefined
      ? undefined
      : await rebasePlanTodo(
          git,
          directory,
          `${onto.commit}..${expectedHead}`,
          plan,
        );
  const exit = await runChange(git, {
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
  const state = await coordination.operation(directory);
  if (state.kind === "rebase") return integrated("Stopped", state);
  const rebased = await readCommit(git, directory, "HEAD");
  await requireLanded(exit, async () => rebased !== head);
  return integrated(
    rebased === head
      ? "UpToDate"
      : rebased === onto.commit
        ? "FastForwarded"
        : "Rebased",
    state,
    exit,
  );
}

async function revertCommits(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  { worktreePath: directory, expectedHead }: StartOperation,
  { commits, commit }: StartRevert,
) {
  if ((await readCommit(git, directory, "HEAD")) !== expectedHead)
    throw operationError("Stale", "HEAD moved. Try again.");
  const outside = await runRepositoryGit(git, directory, [
    "rev-list",
    ...commits,
    "--not",
    "HEAD",
  ]);
  const foreign = commits.find((oid) => outside.includes(oid));
  if (foreign !== undefined)
    throw operationError(
      "Incompatible",
      `${foreign.slice(0, 8)} is not in the checked-out branch.`,
    );
  const exit = await runChange(git, {
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
  const state = await coordination.operation(directory);
  const outcome = commit ? "Committed" : "Staged";
  if (exit._tag === "Failure") {
    if (state.kind === "revert") return started("Stopped", state);
    await requireLanded(exit, () => headMoved(git, directory, expectedHead));
    return started(outcome, state);
  }
  const output = exit.output;
  const empty = /nothing to commit/i.test(`${output.stdout}\n${output.stderr}`);
  if (output.exitCode === 0) return started(outcome, state);
  if (state.kind === "revert" && (state.phase === "conflicts" || empty))
    return started("Stopped", state);
  if (empty)
    throw operationError(
      "Empty",
      "Nothing to revert. The changes are already undone.",
    );
  requireGitSuccess(output);
  return started("Stopped", state);
}

async function onBranch(git: GitCommandRunner, directory: string) {
  const output = await runRepositoryGitOutput(
    git,
    directory,
    ["symbolic-ref", "--quiet", "HEAD"],
    { exitCodes: [0, 1] },
  );
  return output.exitCode === 0;
}
