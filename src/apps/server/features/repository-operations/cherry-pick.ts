import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  StartCherryPick,
  StartOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type GitCommandRunner,
  isGitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import {
  exitCodeOf,
  hasStagedChanges,
  headMoved,
  operationError,
  readCommit,
  requireLanded,
  runChange,
  started,
} from "#server/features/repository-operations/operation-outcome.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

export async function startCherryPick(
  git: GitCommandRunner,
  coordination: RepositoryCoordination,
  { worktreePath: directory, expectedHead }: StartOperation,
  { commits, mainline, result }: StartCherryPick,
) {
  if ((await readCommit(git, directory, "HEAD")) !== expectedHead)
    throw operationError("Stale", "HEAD moved. Try again.");
  const merges = (await readParentCounts(git, directory, commits)).filter(
    (count) => count > 1,
  );
  if (merges.length > 1)
    throw operationError(
      "Incompatible",
      "Cherry-pick one merge commit at a time.",
    );
  if (merges.length === 1 && mainline === null)
    throw operationError(
      "Incompatible",
      "Choose a parent for the merge commit.",
    );
  if (mainline !== null && merges.some((count) => mainline > count))
    throw operationError(
      "Incompatible",
      `The merge commit has no parent ${mainline}.`,
    );
  if (result === "stage" && (await hasStagedChanges(git, directory)))
    throw operationError(
      "Incompatible",
      "Commit or unstage the staged changes first.",
    );
  const exit = await runChange(git, {
    directory,
    arguments: [
      "cherry-pick",
      ...(result === "stage" ? ["--no-commit"] : []),
      ...(mainline === null ? [] : ["-m", String(mainline)]),
      "--end-of-options",
      ...commits,
    ],
    timeoutMilliseconds: 120_000,
  });
  const state = await coordination.operation(directory);
  if (
    exitCodeOf(exit) !== 0 &&
    (state.kind === "cherry-pick" ||
      (result === "stage" && (await hasUnmergedPaths(git, directory))))
  )
    return started("Stopped", state);
  await requireLanded(
    exit,
    result === "stage"
      ? () => hasStagedChanges(git, directory)
      : () => headMoved(git, directory, expectedHead),
  );
  return started(result === "stage" ? "Staged" : "Committed", state);
}

export async function continueStagedCherryPick(
  git: GitCommandRunner,
  directory: string,
) {
  const sequencer = await readStagedSequencer(git, directory);
  if (sequencer === undefined) return false;
  await runRepositoryGit(git, directory, ["cherry-pick", "--quit"]);
  if (sequencer.remaining.length === 0) return true;
  const index = await readIndexTree(git, directory);
  const exit = await runChange(git, {
    directory,
    arguments: [
      "cherry-pick",
      "--no-commit",
      ...(sequencer.mainline === null ? [] : ["-m", sequencer.mainline]),
      "--end-of-options",
      ...sequencer.remaining,
    ],
    timeoutMilliseconds: 120_000,
  });
  if (exitCodeOf(exit) !== 0 && (await hasUnmergedPaths(git, directory)))
    return true;
  await requireLanded(
    exit,
    async () => (await readIndexTree(git, directory)) !== index,
  );
  return true;
}

async function readStagedSequencer(git: GitCommandRunner, directory: string) {
  const path = resolve(
    directory,
    (
      await runRepositoryGit(git, directory, [
        "rev-parse",
        "--git-path",
        "sequencer",
      ])
    ).trim(),
  );
  const [options, todo] = await Promise.all([
    readFile(join(path, "opts"), "utf8"),
    readFile(join(path, "todo"), "utf8"),
  ]).catch(() => [null, null] as const);
  if (options === null || todo === null) return undefined;
  if (!/no-commit\s*=\s*true/.test(options)) return undefined;
  return {
    mainline: /mainline\s*=\s*(\d+)/.exec(options)?.[1] ?? null,
    remaining: todo
      .split("\n")
      .flatMap((line) => /^(?:pick|p)\s+(\S+)/.exec(line)?.[1] ?? [])
      .slice(1),
  };
}

async function readParentCounts(
  git: GitCommandRunner,
  directory: string,
  commits: readonly string[],
) {
  let output: string;
  try {
    output = await runRepositoryGit(git, directory, [
      "rev-list",
      "--no-walk=unsorted",
      "--parents",
      "--end-of-options",
      ...commits,
    ]);
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    throw operationError(
      "Incompatible",
      "A selected commit is not in this repository.",
    );
  }
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(" ").length - 1);
}

async function readIndexTree(git: GitCommandRunner, directory: string) {
  return (
    await runRepositoryGit(git, directory, ["write-tree"], {
      exitCodes: [0, 128],
    })
  ).trim();
}

async function hasUnmergedPaths(git: GitCommandRunner, directory: string) {
  const unmerged = await runRepositoryGit(git, directory, [
    "ls-files",
    "--unmerged",
  ]);
  return unmerged.length > 0;
}
