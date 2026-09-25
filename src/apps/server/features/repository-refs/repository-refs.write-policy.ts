import type { RepositoryWritePolicy } from "#server/domain/repository-coordination.contract";

export const checkoutWritePolicy: RepositoryWritePolicy = {
  name: "checkout",
  locks: { refs: "wait", worktree: "wait" },
  duringOperation: "block",
};

export const branchWritePolicy: RepositoryWritePolicy = {
  name: "branch",
  locks: { refs: "wait" },
  duringOperation: "proceed",
};
