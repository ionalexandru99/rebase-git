import type {
  RepositoryCommit,
  RepositoryHistoryBatch,
  RepositoryHistoryPage,
  RepositoryHistoryRefTarget,
  RepositoryHistorySnapshot,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import {
  acceptRepositoryHistoryBatch,
  completeRepositoryHistory,
  type RepositoryHistoryCompletionBasis,
  type RepositoryHistorySynchronizationProgress,
} from "#web/features/repository-history/repository-history-completion";
import {
  commitKey,
  commitStoreName,
  emptyStoredRepository,
  repositoryKey,
  repositoryStoreName,
  requestResult,
  type StoredCommit,
  type StoredRepository,
  storedCommit,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/features/repository-history/repository-history-database";
import {
  historyOrderScopeKey,
  normalizedOids,
} from "#web/features/repository-history/repository-history-query";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

export interface StoredRepositoryHistoryState {
  readonly completion?: RepositoryHistoryCompletionBasis;
  readonly objectFormat: "sha1" | "sha256";
  readonly refTargets: readonly RepositoryHistoryRefTarget[];
  readonly progress: RepositoryHistorySynchronizationProgress;
  readonly pendingSnapshot?: RepositoryHistorySnapshot;
}

type SynchronizationBasis = NonNullable<SynchronizeRepositoryHistory["basis"]>;

export function storeRepositoryHistoryPage(
  environmentId: string,
  repositoryId: string,
  page: RepositoryHistoryPage,
  query: RepositoryHistoryQuery,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(
      [commitStoreName, repositoryStoreName],
      "readwrite",
    );
    const completed = transactionCompleted(transaction);
    const commits = transaction.objectStore(commitStoreName);
    const repositories = transaction.objectStore(repositoryStoreName);
    const key = repositoryKey(environmentId, repositoryId);
    const current = await requestResult<StoredRepository | undefined>(
      repositories.get(key),
    );
    const existingCommits = await Promise.all(
      page.commits.map((commit) =>
        requestResult<StoredCommit | undefined>(
          commits.get(commitKey(environmentId, repositoryId, commit.oid)),
        ),
      ),
    );
    for (const [index, commit] of page.commits.entries()) {
      commits.put(
        storedCommit(
          environmentId,
          repositoryId,
          commit,
          topologicalPosition(existingCommits[index]),
        ),
      );
    }
    repositories.put({
      ...emptyStoredRepository(environmentId, repositoryId, page.objectFormat),
      ...current,
      cachedPage: {
        scopeKey: historyOrderScopeKey(query),
        oids: page.commits.map((commit) => commit.oid),
        order: query.order,
        requestedLimit: query.limit,
        rootOids: normalizedOids(page.refTargets.map((ref) => ref.oid)),
      },
      objectFormat: page.objectFormat,
      refTargets:
        current?.completion !== undefined ||
        current?.pendingSnapshot !== undefined
          ? current.refTargets
          : page.refTargets,
    } satisfies StoredRepository);
    await completed;
  });
}

export function beginRepositoryHistorySynchronization(
  environmentId: string,
  repositoryId: string,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readwrite");
    const completed = transactionCompleted(transaction);
    const repositories = transaction.objectStore(repositoryStoreName);
    const key = repositoryKey(environmentId, repositoryId);
    const current = await requestResult<StoredRepository | undefined>(
      repositories.get(key),
    );
    if (current === undefined) {
      throw new Error("Repository history has no initial page");
    }
    const basis = synchronizationBasis(current);
    const {
      pendingSnapshot: _,
      pendingTopologicalEpoch: __,
      pendingTopologicalOrder: ___,
      ...withoutPendingSynchronization
    } = current;
    repositories.put(
      basis?._tag === "Incomplete"
        ? current
        : ({
            ...withoutPendingSynchronization,
            progress: {
              committedCommitCount:
                basis?._tag === "Complete" ? basis.commitCount : 0,
              nextBatchSequence: 0,
            },
          } satisfies StoredRepository),
    );
    await completed;
    return basis;
  });
}

export function restartRepositoryHistorySynchronization(
  environmentId: string,
  repositoryId: string,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readwrite");
    const completed = transactionCompleted(transaction);
    const repositories = transaction.objectStore(repositoryStoreName);
    const key = repositoryKey(environmentId, repositoryId);
    const current = await requestResult<StoredRepository | undefined>(
      repositories.get(key),
    );
    if (current === undefined) {
      throw new Error("Repository history has no synchronization state");
    }
    const {
      completion: _,
      pendingSnapshot: __,
      pendingTopologicalEpoch: ___,
      pendingTopologicalOrder: ____,
      ...withoutSynchronizationBasis
    } = current;
    repositories.put({
      ...withoutSynchronizationBasis,
      progress: { committedCommitCount: 0, nextBatchSequence: 0 },
    } satisfies StoredRepository);
    await completed;
  });
}

export function storeRepositoryHistoryBatch(
  environmentId: string,
  repositoryId: string,
  batch: RepositoryHistoryBatch,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(
      [commitStoreName, repositoryStoreName],
      "readwrite",
    );
    const completed = transactionCompleted(transaction);
    const commits = transaction.objectStore(commitStoreName);
    const repositories = transaction.objectStore(repositoryStoreName);
    const key = repositoryKey(environmentId, repositoryId);
    const current = await requestResult<StoredRepository | undefined>(
      repositories.get(key),
    );
    if (current === undefined) {
      throw new Error("Repository history has no synchronization state");
    }
    const progress = acceptRepositoryHistoryBatch(
      current.progress,
      batch.sequence,
      batch.commits.length,
    );
    if (progress !== current.progress) {
      const minimumTopologicalEpoch = current.minimumTopologicalEpoch ?? 0;
      const topologicalEpoch =
        batch.snapshot === undefined
          ? (current.pendingTopologicalEpoch ?? minimumTopologicalEpoch - 1)
          : minimumTopologicalEpoch - 1;
      const topologicalOrder =
        batch.snapshot === undefined
          ? (current.pendingTopologicalOrder ?? 0)
          : 0;
      const existingCommits = await Promise.all(
        batch.commits.map((commit) =>
          requestResult<StoredCommit | undefined>(
            commits.get(commitKey(environmentId, repositoryId, commit.oid)),
          ),
        ),
      );
      for (const [offset, commit] of batch.commits.entries()) {
        if (topologicalPosition(existingCommits[offset]) === undefined) {
          commits.put(
            storedCommit(environmentId, repositoryId, commit, {
              epoch: topologicalEpoch,
              order: topologicalOrder + offset,
            }),
          );
        }
      }
      repositories.put({
        ...current,
        objectFormat: batch.objectFormat,
        ...(batch.snapshot === undefined
          ? {}
          : { pendingSnapshot: batch.snapshot }),
        minimumTopologicalEpoch: Math.min(
          minimumTopologicalEpoch,
          topologicalEpoch,
        ),
        pendingTopologicalEpoch: topologicalEpoch,
        pendingTopologicalOrder: topologicalOrder + batch.commits.length,
        progress,
      } satisfies StoredRepository);
    }
    await completed;
    return progress.committedCommitCount;
  });
}

export function completeStoredRepositoryHistory(
  environmentId: string,
  repositoryId: string,
  reportedCommitCount: number,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readwrite");
    const completed = transactionCompleted(transaction);
    const repositories = transaction.objectStore(repositoryStoreName);
    const key = repositoryKey(environmentId, repositoryId);
    const current = await requestResult<StoredRepository | undefined>(
      repositories.get(key),
    );
    if (current === undefined) {
      throw new Error("Repository history has no synchronization state");
    }
    const snapshot = current.pendingSnapshot;
    const completion = completeRepositoryHistory(
      current.progress,
      reportedCommitCount,
      snapshot,
    );
    const {
      pendingSnapshot: _,
      pendingTopologicalEpoch: __,
      pendingTopologicalOrder: ___,
      ...withoutPendingSynchronization
    } = current;
    repositories.put({
      ...withoutPendingSynchronization,
      completion,
      ...(snapshot === undefined ? {} : { refTargets: snapshot.refTargets }),
    } satisfies StoredRepository);
    await completed;
    return completion;
  });
}

export function readStoredRepositoryHistoryState(
  environmentId: string,
  repositoryId: string,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
): Promise<StoredRepositoryHistoryState | undefined> {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readonly");
    const completed = transactionCompleted(transaction);
    const repository = await requestResult<StoredRepository | undefined>(
      transaction
        .objectStore(repositoryStoreName)
        .get(repositoryKey(environmentId, repositoryId)),
    );
    await completed;
    if (repository === undefined) {
      return undefined;
    }
    return {
      ...(repository.completion === undefined
        ? {}
        : { completion: repository.completion }),
      objectFormat: repository.objectFormat,
      ...(repository.pendingSnapshot === undefined
        ? {}
        : { pendingSnapshot: repository.pendingSnapshot }),
      progress: repository.progress,
      refTargets: repository.refTargets,
    };
  });
}

function synchronizationBasis(
  repository: StoredRepository,
): SynchronizationBasis | undefined {
  if (repository.pendingSnapshot?.resumable === true) {
    return {
      _tag: "Incomplete",
      committedCommitCount: repository.progress.committedCommitCount,
      nextBatchSequence: repository.progress.nextBatchSequence,
      objectFormat: repository.pendingSnapshot.objectFormat,
      rootOids: repository.pendingSnapshot.rootOids,
      snapshotId: repository.pendingSnapshot.id,
    };
  }
  const snapshot = repository.completion?.snapshot;
  return snapshot === undefined
    ? undefined
    : {
        _tag: "Complete",
        commitCount: repository.completion?.commitCount ?? 0,
        objectFormat: snapshot.objectFormat,
        rootOids: snapshot.rootOids,
        snapshotId: snapshot.id,
      };
}

export function storeRepositoryCommits(
  environmentId: string,
  repositoryId: string,
  commits: readonly RepositoryCommit[],
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(commitStoreName, "readwrite");
    const completed = transactionCompleted(transaction);
    const store = transaction.objectStore(commitStoreName);
    for (const commit of commits) {
      store.put(storedCommit(environmentId, repositoryId, commit));
    }
    await completed;
  });
}

function topologicalPosition(commit: StoredCommit | undefined) {
  return commit?.topologicalEpoch === undefined ||
    commit.topologicalOrder === undefined
    ? undefined
    : { epoch: commit.topologicalEpoch, order: commit.topologicalOrder };
}
