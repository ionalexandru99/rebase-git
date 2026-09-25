import type { RepositoryWritePolicy } from "#server/domain/repository-coordination.contract";

export const fetchWritePolicy: RepositoryWritePolicy = {
  name: "fetch",
  locks: { refs: "ifAvailable" },
  duringOperation: "proceed",
};
