import { basename, dirname, isAbsolute, join, sep } from "node:path";
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

export async function readWorktreeFolder(
  git: GitCommandRunner,
  directory: string,
): Promise<WorktreeFolder> {
  const configured = await readConfiguredFolder(git, directory);
  return {
    folder: configured ?? (await defaultWorktreeFolder(git, directory)),
    configured: configured !== undefined,
    separator: sep === "\\" ? "\\" : "/",
  };
}

export async function setWorktreeFolder(
  git: GitCommandRunner,
  command: SetWorktreeFolder,
) {
  const { folder, worktreePath: directory } = command;
  if (folder !== null && !isAbsolute(folder))
    throw {
      _tag: "WorktreeRejected" as const,
      reason: "NotAbsolute" as const,
    };
  await runRepositoryGit(
    git,
    directory,
    folder === null
      ? ["config", "--local", "--unset-all", folderKey]
      : ["config", "--local", "--replace-all", folderKey, folder],
    { exitCodes: folder === null ? [0, 5] : [0] },
  );
  return {};
}

async function readConfiguredFolder(git: GitCommandRunner, directory: string) {
  const output = await runRepositoryGit(
    git,
    directory,
    ["config", "--local", "--get", folderKey],
    { exitCodes: [0, 1] },
  );
  const folder = output.trim();
  return isAbsolute(folder) ? folder : undefined;
}

async function defaultWorktreeFolder(git: GitCommandRunner, directory: string) {
  const main = (await readWorktrees(git, directory)).find(
    (worktree) => worktree.main,
  );
  const root = main?.path ?? (await readGitCommonDirectory(git, directory));
  return join(
    dirname(root),
    `${basename(root).replace(/\.git$/, "")}.worktrees`,
  );
}
