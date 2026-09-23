import { realpath } from "node:fs";
import { promisify } from "node:util";
import type { RepositoryWorktree } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryGitExitError } from "#server/domain/repository-git.contract";
import { parseWorktreeList } from "#server/repository/access/git/parse-worktree-list";

const realpathNative = promisify(realpath.native);

export function readWorktrees(git: GitCommandRunner, directory: string) {
  return git
    .run({
      arguments: ["worktree", "list", "--porcelain", "-z"],
      directory,
      timeoutMilliseconds: 15_000,
    })
    .pipe(
      Effect.flatMap((output) =>
        output.exitCode === 0
          ? Effect.succeed(parseWorktreeList(output.stdout))
          : Effect.fail(new RepositoryGitExitError({ output })),
      ),
    );
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
