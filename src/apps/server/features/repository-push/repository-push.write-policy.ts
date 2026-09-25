import type { RepositoryWritePolicy } from "#server/domain/repository-coordination.contract";

export const pushWritePolicy: RepositoryWritePolicy = {
  name: "push",
  locks: { refs: "wait" },
  duringOperation: "block",
};
