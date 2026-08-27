import type {
  LocalBranch,
  RepositoryCheckedOut,
  RepositoryRefs,
} from "@rebase/contracts";

export function applyRepositoryCheckout(
  refs: RepositoryRefs,
  result: RepositoryCheckedOut,
): RepositoryRefs {
  const checkedOutBranch = result.head.branch;
  const branches = refs.branches.map((branch) =>
    releaseWorktree(branch, result.worktreePath),
  );
  return {
    ...refs,
    branches:
      checkedOutBranch === undefined
        ? branches
        : holdBranchInWorktree(branches, checkedOutBranch, result.worktreePath),
    worktrees: refs.worktrees.map((worktree) =>
      worktree.path === result.worktreePath
        ? { ...worktree, head: result.head }
        : worktree,
    ),
  };
}

function releaseWorktree(branch: LocalBranch, worktreePath: string) {
  if (branch.worktreePath !== worktreePath) return branch;
  const { worktreePath: _released, ...released } = branch;
  return released;
}

function holdBranchInWorktree(
  branches: readonly LocalBranch[],
  name: string,
  worktreePath: string,
): readonly LocalBranch[] {
  return branches.some((branch) => branch.name === name)
    ? branches.map((branch) =>
        branch.name === name ? { ...branch, worktreePath } : branch,
      )
    : [{ name, worktreePath }, ...branches];
}
