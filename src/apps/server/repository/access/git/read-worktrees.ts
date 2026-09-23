import { realpath } from "node:fs";
import { promisify } from "node:util";
import type { RepositoryWorktree } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { parseWorktreeList } from "#server/repository/access/git/parse-worktree-list";
import { runRepositoryGit } from "#server/repository/access/run-repository-git";

const realpathNative = promisify(realpath.native);

export function readWorktrees(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    ["worktree", "list", "--porcelain", "-z"],
    { timeoutMilliseconds: 15_000 },
  ).pipe(Effect.map(parseWorktreeList));
}

export function canonicalizeWorktrees(
  worktrees: readonly RepositoryWorktree[],
) {
  return Effect.all(
    worktrees.map((worktree) =>
      Effect.promise(async () => ({
        ...worktree,
        path: await realpathNative(worktree.path).catch(() => worktree.path),
      })),
    ),
    { concurrency: "unbounded" },
  );
}
