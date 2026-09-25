import type { RepositoryWritePolicy } from "#server/domain/repository-coordination.contract";

export const pullWritePolicy: RepositoryWritePolicy = {
  name: "pull",
  locks: { refs: "wait", worktree: "wait" },
  duringOperation: "block",
};
