import type {
  LocalBranch,
  RepositoryBranchDeleted,
  RepositoryRefs,
} from "@rebase/contracts";

export function withBranch(
  refs: RepositoryRefs,
  branch: LocalBranch,
): RepositoryRefs {
  const exists = refs.branches.some(({ name }) => name === branch.name);
  return {
    ...refs,
    branches: exists
      ? refs.branches.map((current) =>
          current.name === branch.name ? branch : current,
        )
      : [branch, ...refs.branches],
  };
}

export function withRenamedBranch(
  refs: RepositoryRefs,
  previousName: string,
  branch: LocalBranch,
): RepositoryRefs {
  return withBranch(
    {
      ...withoutBranch(refs, previousName),
      worktrees: refs.worktrees.map((worktree) =>
        worktree.head.branch === previousName
          ? { ...worktree, head: { ...worktree.head, branch: branch.name } }
          : worktree,
      ),
    },
    branch,
  );
}

export function withoutBranch(
  refs: RepositoryRefs,
  name: string,
): RepositoryRefs {
  return {
    ...refs,
    branches: refs.branches.filter((branch) => branch.name !== name),
  };
}

export function withoutDeletedBranches(
  refs: RepositoryRefs,
  { local, remote }: RepositoryBranchDeleted,
): RepositoryRefs {
  const withoutLocal =
    local === undefined ? refs : withoutBranch(refs, local.name);
  if (remote === undefined) return withoutLocal;
  const upstreamName = `${remote.remote}/${remote.name}`;
  return {
    ...withoutLocal,
    branches: withoutLocal.branches.map((branch) =>
      branch.upstream?.name === upstreamName
        ? { ...branch, upstream: { ...branch.upstream, gone: true } }
        : branch,
    ),
    remoteBranches: withoutLocal.remoteBranches.filter(
      (branch) =>
        branch.remote !== remote.remote || branch.name !== remote.name,
    ),
  };
}
