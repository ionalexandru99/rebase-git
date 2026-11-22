import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SettledDay } from "#contracts/branch-settling/branch-settling.contract.ts";
import {
  type GitCommandRunner,
  readGitCommonDirectory,
} from "#server/adapters/local-git/git-commands.ts";
import {
  settledGroups,
  settlePolicy,
} from "#server/features/branch-settling/branch-settling.ts";
import {
  branchRef,
  worktreeHolding,
} from "#server/features/repository-refs/git/branches/branch-git.ts";
import {
  deleteLocals,
  readRefTargets,
  unmergedBranches,
} from "#server/features/repository-refs/git/branches/delete-branches.ts";
import { removeWorktree } from "#server/features/repository-worktrees/repository-worktrees.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

const dayMilliseconds = 86_400_000;
const isSettledDay = (value: unknown) => SettledDay.safeParse(value).success;
const operationBranchFiles = [
  "rebase-merge/head-name",
  "rebase-apply/head-name",
  "BISECT_START",
];

export interface SettledCandidate {
  readonly name: string;
  readonly mergedTip?: string;
}

export function settledLongEnough(
  settled: string,
  today: string,
  days: number,
) {
  return (
    days > 0 &&
    isSettledDay(settled) &&
    (Date.parse(today) - Date.parse(settled)) / dayMilliseconds >= days
  );
}

export async function operationBranches(
  git: GitCommandRunner,
  directory: string,
) {
  const common = await readGitCommonDirectory(git, directory);
  const linked = await readdir(join(common, "worktrees")).catch(
    (): string[] => [],
  );
  const contents = await Promise.all(
    [common, ...linked.map((id) => join(common, "worktrees", id))].flatMap(
      (gitDirectory) =>
        operationBranchFiles.map((file) =>
          readFile(join(gitDirectory, file), "utf8").catch(() => ""),
        ),
    ),
  );
  return new Set(
    contents
      .map((content) => content.trim().replace(/^refs\/heads\//, ""))
      .filter((branch) => branch !== ""),
  );
}

export async function deleteSettledBranches(
  git: GitCommandRunner,
  access: RepositoryAccess,
  coordination: RepositoryCoordination,
  directory: string,
  candidates: readonly SettledCandidate[],
) {
  let deleted = false;
  for (const group of settledGroups(candidates)) {
    const groupDeleted = await coordination
      .run(directory, settlePolicy, () =>
        deleteSettledGroup(git, access, directory, group),
      )
      .catch(() => true);
    deleted ||= groupDeleted;
  }
  return deleted;
}

async function deleteSettledGroup(
  git: GitCommandRunner,
  access: RepositoryAccess,
  directory: string,
  candidates: readonly SettledCandidate[],
) {
  const refs = await readRefTargets(git, directory);
  const settled = candidates.flatMap(({ name, mergedTip }) => {
    const target = refs.get(branchRef(name));
    return target === undefined ||
      (mergedTip !== undefined && mergedTip !== target)
      ? []
      : [{ local: { name, target }, mergedAtTip: mergedTip !== undefined }];
  });
  if (settled.length === 0) return false;
  const unchecked = settled.flatMap(({ local, mergedAtTip }) =>
    mergedAtTip ? [] : [{ local }],
  );
  const unmerged = new Set(
    unchecked.length === 0
      ? []
      : (await unmergedBranches(git, directory, unchecked, refs)).map(
          ({ branch }) => branch.local?.name,
        ),
  );
  const worktrees = await access.worktrees(directory);
  const busy = await operationBranches(git, directory);
  let deleted = false;
  for (const { local } of settled) {
    if (unmerged.has(local.name) || busy.has(local.name)) continue;
    const holder = worktreeHolding(worktrees, local.name);
    if (
      holder !== undefined &&
      (await readRefTargets(git, directory)).get(branchRef(local.name)) !==
        local.target
    )
      continue;
    const removed =
      holder === undefined ||
      (await removeWorktree(git, {
        worktreePath: directory,
        target: holder.path,
        changes: 0,
      }).then(
        () => true,
        () => false,
      ));
    if (!removed) continue;
    deleted = true;
    await deleteLocals(git, directory, [local]).catch(() => undefined);
  }
  return deleted;
}
