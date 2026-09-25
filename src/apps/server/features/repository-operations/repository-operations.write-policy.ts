import type { RepositoryWritePolicy } from "#server/domain/repository-coordination.contract";

export const recoverWritePolicy: RepositoryWritePolicy = {
  name: "recover",
  locks: { refs: "wait", worktree: "wait" },
  duringOperation: "proceed",
};
