import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Array as Arrays, Effect, Schema } from "effect";
import { SettledDay } from "#contracts/branch-settling/branch-settling.contract.ts";
import {
  type GitCommandRunner,
  readGitCommonDirectory,
} from "#server/adapters/local-git/git-commands.ts";
import {
  settledPerLock,
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

export function operationBranches(git: GitCommandRunner, directory: string) {
  return readGitCommonDirectory(git, directory).pipe(
    Effect.flatMap((common) =>
      Effect.promise(async () => {
        const linked = await readdir(join(common, "worktrees")).catch(
          (): string[] => [],
        );
        const contents = await Promise.all(
          [
            common,
            ...linked.map((id) => join(common, "worktrees", id)),
          ].flatMap((gitDirectory) =>
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
      }),
    ),
  );
}

export function deleteSettledBranches(
  git: GitCommandRunner,
  access: RepositoryAccess,
  coordination: RepositoryCoordination,
  directory: string,
  candidates: readonly SettledCandidate[],
) {
  return Effect.forEach(Arrays.chunksOf(candidates, settledPerLock), (group) =>
    coordination
      .run(
        directory,
        settlePolicy,
        deleteSettledGroup(git, access, directory, group),
      )
      .pipe(Effect.catch(() => Effect.succeed(true))),
  ).pipe(Effect.map((deleted) => deleted.includes(true)));
}

function deleteSettledGroup(
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
    const busy = yield* operationBranches(git, directory);
    let deleted = false;
    for (const { local } of settled) {
      if (unmerged.has(local.name) || busy.has(local.name)) continue;
      const holder = worktreeHolding(worktrees, local.name);
      if (
        holder !== undefined &&
        (yield* readRefTargets(git, directory)).get(branchRef(local.name)) !==
          local.target
      )
        continue;
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
