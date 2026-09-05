import {
  clearHistoryCache,
  markHistoryCacheOpened,
} from "#web/features/repository-history/cache/repository-history-storage";
import { writeHistoryUnderPressure } from "#web/features/repository-history/cache/repository-history-storage-maintenance";
import { prepareRepositoryHistoryOrder } from "#web/features/repository-history/query/repository-history-query";
import { readStoredRepositoryHistoryState } from "#web/features/repository-history/replica/repository-history-store";
import type { RepositoryReplica } from "#web/features/repository-history/worker/history-worker.contract";
import {
  invalidateStoredHistory,
  publishSnapshot,
  workerFailure,
} from "#web/features/repository-history/worker/replica-state";

export function createReplica(
  environmentId: string,
  repositoryId: string,
): RepositoryReplica {
  const replica: RepositoryReplica = {
    orderCache: { queries: new Map(), revision: 0 },
    reconciled: false,
    shallowOids: [],
    freshnessCommands: new Map(),
    needsReconciliation: false,
    initialization: Promise.resolve(),
    readers: new Set(),
    refTargets: [],
    revision: 0,
    status: "empty",
    synchronization: { status: "idle" },
    synchronizedCommitCount: 0,
  };
  replica.initialization = restoreReplica(replica, environmentId, repositoryId);
  return replica;
}

async function restoreReplica(
  replica: RepositoryReplica,
  environmentId: string,
  repositoryId: string,
) {
  try {
    if (!(await markHistoryCacheOpened(environmentId, repositoryId))) {
      await clearHistoryCache(environmentId, repositoryId, false);
      invalidateStoredHistory(replica, true);
      replica.revision += 1;
      publishSnapshot(replica);
      return;
    }
    const state = await readStoredRepositoryHistoryState(
      environmentId,
      repositoryId,
    );
    if (state === undefined) {
      return;
    }
    replica.refTargets = state.refTargets;
    replica.synchronizedCommitCount = state.progress.committedCommitCount;
    if (state.completion !== undefined) {
      void prepareRepositoryHistoryOrder(
        environmentId,
        repositoryId,
        replica.orderCache,
      ).catch(() => undefined);
      replica.shallowOids = state.completion.snapshot?.shallowOids ?? [];
      replica.synchronization = { status: "complete" };
      replica.synchronizedCommitCount = state.completion.commitCount;
      replica.status = state.completion.commitCount === 0 ? "empty" : "ready";
    }
    replica.revision += 1;
    publishSnapshot(replica);
  } catch (error) {
    replica.failure = workerFailure(error);
    replica.status = "error";
    replica.revision += 1;
    publishSnapshot(replica);
  }
}

export function writeStoredHistory<T>(write: () => Promise<T>) {
  return writeHistoryUnderPressure(write, (key) => repositories.has(key));
}

export const repositories = new Map<string, RepositoryReplica>();
