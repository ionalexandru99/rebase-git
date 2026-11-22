import { readdir, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  type CreateWorktree,
  type RemoveWorktree,
  type RepositoryWorktreeStatus,
  RepositoryWorktreesApi,
  type WorktreeChanged,
  type WorktreeRejected,
  type WorktreeTarget,
} from "#contracts/repository-worktrees/repository-worktrees.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  type GitFailed,
  isGitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { conflicted } from "#server/features/repository-changes/git/read-changes.ts";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures.ts";
import {
  readBranchTarget,
  requireRemoteBranch,
  requireValidBranchName,
  setUpstreamArguments,
} from "#server/features/repository-refs/git/branches/branch-git.ts";
import { refCommand } from "#server/features/repository-refs/git/ref-git.ts";
import {
  readWorktreeFolder,
  setWorktreeFolder,
} from "#server/features/repository-worktrees/worktree-folder.ts";
import { readWorktrees } from "#server/repository/repository-access.ts";
import type { RepositoryWritePolicy } from "#server/repository/repository-coordination.ts";

const worktreeCommand = { ...refCommand, timeoutMilliseconds: 300_000 };

const worktreePolicy: RepositoryWritePolicy = {
  name: "change worktrees",
  locks: { refs: "wait" },
  duringOperation: "proceed",
};

export function repositoryWorktreesFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command, query } = repositoryRoutes(dependencies);
  const api = RepositoryWorktreesApi;
  return {
    routes: [
      query(api.status, (input, git) =>
        readWorktreeStatus(git, input.worktreePath),
      ),
      query(api.folder, (input, git) =>
        readWorktreeFolder(git, input.worktreePath),
      ),
      command(api.create, worktreePolicy, (input, git) =>
        createWorktree(git, input),
      ),
      command(api.remove, worktreePolicy, (input, git) =>
        removeWorktree(git, input),
      ),
      command(api.unlock, worktreePolicy, (input, git) =>
        unlockWorktree(git, input),
      ),
      command(api.setFolder, worktreePolicy, (input, git) =>
        setWorktreeFolder(git, input),
      ),
    ],
  };
}

export async function readWorktreeStatus(
  git: GitCommandRunner,
  directory: string,
): Promise<RepositoryWorktreeStatus> {
  const worktrees = (await readWorktrees(git, directory)).filter(
    (worktree) => worktree.missing !== true,
  );
  return {
    worktrees: await mapWithConcurrency(worktrees, 4, async (worktree) => ({
      path: worktree.path,
      ...(await countChanges(git, worktree.path)),
    })),
  };
}

export async function createWorktree(
  git: GitCommandRunner,
  command: CreateWorktree,
) {
  const { start, worktreePath: directory } = command;
  if (!isAbsolute(command.path)) throw rejected("NotAbsolute");
  if (!(await folderIsFree(command.path))) throw rejected("FolderExists");
  if (start._tag === "Branch") {
    if ((await readBranchTarget(git, directory, start.name)) === undefined)
      throw { _tag: "RefMissing" as const, name: start.name };
    await addWorktree(git, directory, start.name, [command.path, start.name]);
  } else {
    const { name, startPoint, track } = start;
    await requireValidBranchName(git, directory, name);
    if (track !== undefined) await requireRemoteBranch(git, directory, track);
    try {
      await runRepositoryGit(
        git,
        directory,
        ["branch", "--no-track", name, startPoint],
        refCommand,
      );
    } catch (error) {
      if (!isGitFailed(error)) throw error;
      throw /not a valid object name/i.test(error.detail)
        ? { _tag: "RefMissing" as const, name: startPoint }
        : branchWriteFailed(error, name);
    }
    try {
      if (track !== undefined)
        await runRepositoryGit(
          git,
          directory,
          setUpstreamArguments(name, track),
          refCommand,
        ).catch((error: unknown) => {
          throw isGitFailed(error) ? branchWriteFailed(error, name) : error;
        });
      await addWorktree(git, directory, name, [command.path, name]);
    } catch (error) {
      await runRepositoryGit(git, directory, ["branch", "-D", name], {
        ...refCommand,
        signal: new AbortController().signal,
      }).catch(() => undefined);
      throw error;
    }
  }
  const worktreePath = await realpath(command.path).catch(() => command.path);
  return { worktreePath };
}

export async function removeWorktree(
  git: GitCommandRunner,
  command: Omit<RemoveWorktree, "repositoryId">,
) {
  const worktree = await findRemovable(git, command);
  if (worktree === undefined) return {};
  if (
    worktree.head.branch === undefined &&
    (await commitsOnNoBranch(git, command.worktreePath, worktree.head.commit))
  )
    throw rejected("Unsaved");
  const { unstaged, staged } =
    worktree.missing === true
      ? { unstaged: 0, staged: 0 }
      : await countChanges(git, worktree.path);
  const changes = unstaged + staged;
  if (changes > 0 && changes !== command.changes)
    throw { _tag: "WorktreeChanged", changes } satisfies WorktreeChanged;
  await runRepositoryGit(
    git,
    command.worktreePath,
    ["worktree", "remove", ...(changes > 0 ? ["--force"] : []), worktree.path],
    worktreeCommand,
  );
  return {};
}

export async function unlockWorktree(
  git: GitCommandRunner,
  command: WorktreeTarget,
) {
  const worktree = await findTarget(git, command);
  if (worktree?.locked === undefined) return {};
  await runRepositoryGit(
    git,
    command.worktreePath,
    ["worktree", "unlock", worktree.path],
    refCommand,
  );
  return {};
}

async function addWorktree(
  git: GitCommandRunner,
  directory: string,
  branch: string,
  arguments_: readonly string[],
) {
  try {
    await runRepositoryGit(
      git,
      directory,
      ["worktree", "add", ...arguments_],
      worktreeCommand,
    );
  } catch (error) {
    throw isGitFailed(error) ? addFailed(error, branch) : error;
  }
}

function addFailed(error: GitFailed, branch: string) {
  if (/^fatal: '.*' already exists$/m.test(error.detail))
    return rejected("FolderExists");
  const holder = /already (?:checked out|used by worktree) at '([^']+)'/.exec(
    error.detail,
  )?.[1];
  if (holder !== undefined)
    return {
      _tag: "BranchCheckedOutElsewhere" as const,
      name: branch,
      worktreePath: holder,
    };
  return branchWriteFailed(error, branch);
}

function folderIsFree(path: string) {
  return readdir(path).then(
    (entries) => entries.length === 0,
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );
}

async function findRemovable(
  git: GitCommandRunner,
  command: Omit<WorktreeTarget, "repositoryId">,
) {
  const worktree = await findTarget(git, command);
  if (worktree === undefined) return undefined;
  if (worktree.main) throw rejected("Main");
  if (worktree.path === command.worktreePath) throw rejected("Current");
  if (worktree.locked !== undefined) throw rejected("Locked");
  return worktree;
}

async function findTarget(
  git: GitCommandRunner,
  command: Omit<WorktreeTarget, "repositoryId">,
) {
  const worktrees = await readWorktrees(git, command.worktreePath);
  return worktrees.find((worktree) => worktree.path === command.target);
}

async function commitsOnNoBranch(
  git: GitCommandRunner,
  directory: string,
  commit: string,
) {
  const output = await runRepositoryGit(
    git,
    directory,
    [
      "rev-list",
      "--max-count=1",
      commit,
      "--not",
      "--branches",
      "--tags",
      "--remotes",
    ],
    refCommand,
  );
  return output.trim().length > 0;
}

async function countChanges(git: GitCommandRunner, directory: string) {
  const output = await runRepositoryGit(git, directory, [
    "status",
    "--porcelain",
    "-z",
    "--no-renames",
    "--untracked-files=normal",
  ]);
  const codes = output
    .split("\0")
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.slice(0, 2));
  return {
    unstaged: codes.filter((xy) => xy[1] !== " ").length,
    staged: codes.filter(
      (xy) => xy[0] !== " " && xy[0] !== "?" && !conflicted(xy),
    ).length,
  };
}

async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  map: (item: Item) => Promise<Result>,
) {
  const results: Result[] = new Array(items.length);
  let next = 0;
  const work = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index] as Item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, work),
  );
  return results;
}

function rejected(reason: WorktreeRejected["reason"]): WorktreeRejected {
  return { _tag: "WorktreeRejected", reason };
}
