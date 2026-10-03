import { basename, dirname, isAbsolute, join, sep } from "node:path";
import { Effect } from "effect";
import type {
  SetWorktreeFolder,
  WorktreeFolder,
} from "#contracts/repository-worktrees/repository-worktrees.contract.ts";
import {
  type GitCommandRunner,
  readGitCommonDirectory,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { readWorktrees } from "#server/repository/repository-access.ts";

const folderKey = "rebase.worktreeFolder";

export function readWorktreeFolder(git: GitCommandRunner, directory: string) {
  return Effect.gen(function* () {
    const configured = yield* readConfiguredFolder(git, directory);
    return {
      folder: configured ?? (yield* defaultWorktreeFolder(git, directory)),
      configured: configured !== undefined,
      separator: sep === "\\" ? "\\" : "/",
    } satisfies WorktreeFolder;
  });
}

export function setWorktreeFolder(
  git: GitCommandRunner,
  command: SetWorktreeFolder,
) {
  const { folder, worktreePath: directory } = command;
  return Effect.gen(function* () {
    if (folder !== null && !isAbsolute(folder))
      return yield* Effect.fail({
        _tag: "WorktreeRejected" as const,
        reason: "NotAbsolute" as const,
      });
    yield* runRepositoryGit(
      git,
      directory,
      folder === null
        ? ["config", "--local", "--unset-all", folderKey]
        : ["config", "--local", "--replace-all", folderKey, folder],
      { exitCodes: folder === null ? [0, 5] : [0] },
    );
    return {};
  });
}

function readConfiguredFolder(git: GitCommandRunner, directory: string) {
  return runRepositoryGit(
    git,
    directory,
    ["config", "--local", "--get", folderKey],
    { exitCodes: [0, 1] },
  ).pipe(
    Effect.map((output) => {
      const folder = output.trim();
      return isAbsolute(folder) ? folder : undefined;
    }),
  );
}

function defaultWorktreeFolder(git: GitCommandRunner, directory: string) {
  return readWorktrees(git, directory).pipe(
    Effect.flatMap((worktrees) => {
      const main = worktrees.find((worktree) => worktree.main);
      return main === undefined
        ? readGitCommonDirectory(git, directory)
        : Effect.succeed(main.path);
    }),
    Effect.map((root) =>
      join(dirname(root), `${basename(root).replace(/\.git$/, "")}.worktrees`),
    ),
  );
}
