import type {
  RenameRepositoryBranch,
  RepositoryBranchesOperationFailure,
  RepositoryBranchRenamed,
} from "#contracts/repository-refs/repository-branches.contract.ts";
import type { RepositoryWorktree } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  type GitCommandRunner,
  isGitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { branchWriteFailed } from "#server/features/repository-refs/git/branches/branch-failures.ts";
import {
  readBranchTarget,
  readLocalBranch,
  requireValidBranchName,
  worktreeHolding,
} from "#server/features/repository-refs/git/branches/branch-git.ts";
import { refCommand } from "#server/features/repository-refs/git/ref-git.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

export async function renameBranch(
  git: GitCommandRunner,
  access: RepositoryAccess,
  command: RenameRepositoryBranch,
): Promise<RepositoryBranchRenamed> {
  const { name, newName, worktreePath } = command;
  await requireValidBranchName(git, worktreePath, newName);
  const before = await access.worktrees(worktreePath);
  rejectHeldElsewhere(before, name, worktreePath);
  await requireRenameSource(git, command, before);
  try {
    await runRepositoryGit(
      git,
      worktreePath,
      ["branch", "-m", name, newName],
      refCommand,
    );
  } catch (error) {
    throw isGitFailed(error) ? branchWriteFailed(error, newName) : error;
  }
  const after = await access.worktrees(worktreePath);
  const branch = await readLocalBranch(git, worktreePath, after, newName);
  return { branch, previousName: name };
}

async function requireRenameSource(
  git: GitCommandRunner,
  { expectedTarget, name, worktreePath }: RenameRepositoryBranch,
  worktrees: readonly RepositoryWorktree[],
) {
  const target = await readBranchTarget(git, worktreePath, name);
  if (target !== undefined) {
    if (target !== expectedTarget)
      throw {
        _tag: "BranchMoved",
        name,
      } satisfies RepositoryBranchesOperationFailure;
    return;
  }
  const unbornHere =
    expectedTarget === undefined &&
    worktreeHolding(worktrees, name)?.path === worktreePath;
  if (!unbornHere)
    throw {
      _tag: "RefMissing",
      name,
    } satisfies RepositoryBranchesOperationFailure;
}

function rejectHeldElsewhere(
  worktrees: readonly RepositoryWorktree[],
  name: string,
  worktreePath: string,
) {
  const holder = worktreeHolding(worktrees, name);
  if (holder !== undefined && holder.path !== worktreePath)
    throw {
      _tag: "BranchCheckedOutElsewhere",
      name,
      worktreePath: holder.path,
    } satisfies RepositoryBranchesOperationFailure;
}
