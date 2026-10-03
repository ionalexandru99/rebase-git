import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect, Schema } from "effect";
import { SettledDay } from "#contracts/branch-settling/branch-settling.contract.ts";
import type { RepositoryWorktree } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
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

const dayMilliseconds = 86_400_000;
const isSettledDay = Schema.is(SettledDay);
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

export function heldBranches(
  git: GitCommandRunner,
  worktree: RepositoryWorktree,
) {
  if (worktree.head.branch !== undefined)
    return Effect.succeed([worktree.head.branch]);
  if (worktree.missing) return Effect.succeed([]);
  return runRepositoryGit(git, worktree.path, [
    "rev-parse",
    ...operationBranchFiles.flatMap((file) => ["--git-path", file]),
  ]).pipe(
    Effect.map((output) => output.split("\n").filter((line) => line !== "")),
    Effect.flatMap((paths) =>
      Effect.promise(() =>
        Promise.all(
          paths.map((path) =>
            readFile(resolve(worktree.path, path), "utf8").catch(() => ""),
          ),
        ),
      ),
    ),
    Effect.map((contents) =>
      contents
        .map((content) => content.trim().replace(/^refs\/heads\//, ""))
        .filter((branch) => branch !== ""),
    ),
  );
}

export function deleteSettledBranches(
  git: GitCommandRunner,
  access: RepositoryAccess,
  directory: string,
  candidates: readonly SettledCandidate[],
) {
  return Effect.gen(function* () {
    const refs = yield* readRefTargets(git, directory);
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
        : (yield* unmergedBranches(git, directory, unchecked, refs)).map(
            ({ branch }) => branch.local?.name,
          ),
    );
    const worktrees = yield* access.worktrees(directory);
    const busy = new Set(
      (yield* Effect.forEach(
        worktrees.filter((worktree) => worktree.head.branch === undefined),
        (worktree) => heldBranches(git, worktree),
      )).flat(),
    );
    let deleted = false;
    for (const { local } of settled) {
      if (unmerged.has(local.name) || busy.has(local.name)) continue;
      const holder = worktreeHolding(worktrees, local.name);
      if (holder?.missing) continue;
      const removed =
        holder === undefined ||
        (yield* removeWorktree(git, {
          worktreePath: directory,
          target: holder.path,
          changes: 0,
        }).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        ));
      if (!removed) continue;
      deleted = true;
      yield* deleteLocals(git, directory, [local]).pipe(
        Effect.catch(() => Effect.void),
      );
    }
    return deleted;
  });
}
