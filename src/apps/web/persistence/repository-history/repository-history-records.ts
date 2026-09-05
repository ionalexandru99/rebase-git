import type { RepositoryCommit } from "@rebase/contracts";
import type {
  StoredCommit,
  StoredRepository,
} from "#web/persistence/repository-history/repository-history-database.contract";

export function emptyStoredRepository(
  environmentId: string,
  repositoryId: string,
  objectFormat: "sha1" | "sha256",
): StoredRepository {
  return {
    environmentId,
    key: repositoryKey(environmentId, repositoryId),
    cacheFormatVersion: 1,
    lastOpenedAt: Date.now(),
    objectFormat,
    minimumTopologicalEpoch: 0,
    progress: { committedCommitCount: 0, nextBatchSequence: 0 },
    refTargets: [],
    repositoryId,
  };
}

export function storedCommit(
  environmentId: string,
  repositoryId: string,
  commit: RepositoryCommit,
  topologicalPosition?: {
    readonly epoch: number;
    readonly order: number;
  },
): StoredCommit {
  return {
    commit,
    environmentId,
    key: commitKey(environmentId, repositoryId, commit.oid),
    repositoryId,
    ...(topologicalPosition === undefined
      ? {}
      : {
          topologicalEpoch: topologicalPosition.epoch,
          topologicalOrder: topologicalPosition.order,
        }),
  };
}

export function repositoryKey(environmentId: string, repositoryId: string) {
  return `${environmentId}\0${repositoryId}`;
}

export function commitKey(
  environmentId: string,
  repositoryId: string,
  oid: string,
) {
  return `${repositoryKey(environmentId, repositoryId)}\0${oid}`;
}
