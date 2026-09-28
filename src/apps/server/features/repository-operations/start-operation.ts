import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  MergeMode,
  OperationFailure,
  OperationStarted,
  RepositoryOperation,
  StartMerge,
  StartOperation,
  StartRebase,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type GitCommandOutput,
  type GitCommandRunner,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

export function startOperation(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  command: StartOperation,
) {
  const { operation } = command;
  return operation._tag === "Merge"
    ? startMerge(git, coordination, command, operation)
    : startRebase(git, coordination, command, operation);
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
  { worktreePath: directory, expectedHead }: StartOperation,
  { source, mode }: StartMerge,
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

function startRebase(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  { worktreePath: directory, expectedHead }: StartOperation,
  { onto, stash }: StartRebase,
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
        runRepositoryGit(
          git,
          directory,
          [
            "rev-list",
            "--merges",
            "--max-count=1",
            `${onto.commit}..${expectedHead}`,
          ],
          { exitCodes: [0, 128] },
        ),
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
    const output = yield* git
      .run({
        directory,
        arguments: [
          "rebase",
          merges.length > 0 ? "--rebase-merges" : "--no-rebase-merges",
          stash ? "--autostash" : "--no-autostash",
          "--end-of-options",
          revision,
        ],
        timeoutMilliseconds: 600_000,
      })
      .pipe(Effect.mapError(uncertain), Effect.uninterruptible);
    const state = yield* coordination.operation(directory);
    if (state.kind === "rebase") return started("Stopped", state);
    yield* requireGitSuccess(output);
    if (/resulted in conflicts/.test(`${output.stdout}\n${output.stderr}`))
      return yield* operationFailure(
        "GitRejected",
        `${output.stderr}${output.stdout}`,
      );
    const rebased = yield* readCommit(git, directory, "HEAD");
    return started(
      rebased === head
        ? "UpToDate"
        : rebased === onto.commit
          ? "FastForwarded"
          : "Rebased",
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

export function requireGitSuccess(output: GitCommandOutput) {
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

export function uncertain() {
  return operationError(
    "Uncertain",
    "Git's result could not be confirmed. Refresh the worktree before trying again.",
  );
}

function operationFailure(reason: OperationFailure["reason"], detail: string) {
  return Effect.fail(operationError(reason, detail));
}

export function operationError(
  reason: OperationFailure["reason"],
  detail: string,
): OperationFailure {
  return { _tag: "OperationFailed", reason, detail: detail.slice(0, 2048) };
}
