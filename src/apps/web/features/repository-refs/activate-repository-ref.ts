import type { RepositoryRefs, RepositoryRefTarget } from "@rebase/contracts";
import type { RepositoryRefActivation } from "#web/features/repository-refs/repository-ref-activation.contract";

export function resolveRefActivation(
  refs: RepositoryRefs,
  activeWorktreePath: string,
  target: RepositoryRefTarget,
): RepositoryRefActivation {
  if (target._tag === "RemoteBranch") {
    return refs.branches.some(
      (branch) =>
        branch.name === target.name &&
        (branch.upstream === undefined ||
          branch.upstream.name === `${target.remote}/${target.name}`),
    )
      ? resolveRefActivation(refs, activeWorktreePath, {
          _tag: "LocalBranch",
          name: target.name,
        })
      : { _tag: "Checkout", target };
  }
  if (target._tag === "Tag") return { _tag: "Checkout", target };

  const branch = refs.branches.find(
    (candidate) => candidate.name === target.name,
  );
  if (
    branch?.worktreePath !== undefined &&
    branch.worktreePath !== activeWorktreePath
  ) {
    return { _tag: "SwitchWorktree", worktreePath: branch.worktreePath };
  }
  return activeHead(refs, activeWorktreePath)?.branch === target.name
    ? { _tag: "AlreadyCurrent" }
    : { _tag: "Checkout", target };
}

export function activeHead(refs: RepositoryRefs, activeWorktreePath: string) {
  return refs.worktrees.find((worktree) => worktree.path === activeWorktreePath)
    ?.head;
}

export function resolveActiveWorktreePath(
  refs: RepositoryRefs,
  preferredPath: string,
): string {
  if (refs.worktrees.some((worktree) => worktree.path === preferredPath)) {
    return preferredPath;
  }
  return (
    refs.worktrees.find((worktree) => worktree.main)?.path ??
    refs.worktrees[0]?.path ??
    preferredPath
  );
}
