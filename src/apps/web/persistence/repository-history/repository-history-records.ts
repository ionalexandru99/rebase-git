import type { RepositoryCommit } from "@rebase/contracts";
import type {
  NewStoredRepository,
  StoredCommit,
} from "#web/persistence/repository-history/repository-history-database.contract";

export function emptyStoredRepository(
  environmentId: string,
  repositoryId: string,
  objectFormat: "sha1" | "sha256",
): NewStoredRepository {
  return {
    environmentId,
    commitCount: 0,
    lastOpenedAt: Date.now(),
    objectFormat,
    minimumTopologicalEpoch: 0,
    progress: { committedCommitCount: 0, nextBatchSequence: 0 },
    refTargets: [],
    repositoryId,
  };
}

export function storedCommit(
  commit: RepositoryCommit,
  topologicalPosition?: {
    readonly epoch: number;
    readonly order: number;
  },
): StoredCommit {
  return topologicalPosition === undefined
    ? { commit }
    : {
        commit,
        topologicalEpoch: topologicalPosition.epoch,
        topologicalOrder: topologicalPosition.order,
      };
}

export function repositoryKey(environmentId: string, repositoryId: string) {
  return `${environmentId}\0${repositoryId}`;
}
