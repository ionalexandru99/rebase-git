import type {
  RepositoryHistoryBatch,
  RepositoryHistoryPage,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import {
  historyOrderScopeKey,
  normalizedOids,
} from "#web/features/repository-history/query/repository-history-query";
import {
  acceptRepositoryHistoryBatch,
  completeRepositoryHistory,
} from "#web/features/repository-history/replica/repository-history-completion";
import type { StoredRepositoryHistoryState } from "#web/features/repository-history/replica/repository-history-state.contract";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";
import type {
  StoredCommit,
  StoredRepository,
} from "#web/persistence/repository-history/repository-history-database.contract";
import {
  commitKey,
  emptyStoredRepository,
  repositoryKey,
  storedCommit,
} from "#web/persistence/repository-history/repository-history-records";
import {
  readStoredRepository,
  updateStoredHistory,
  updateStoredRepository,
} from "#web/persistence/repository-history/repository-history-transactions";

type SynchronizationBasis = NonNullable<SynchronizeRepositoryHistory["basis"]>;

export function storeRepositoryHistoryPage(
  environmentId: string,
  repositoryId: string,
  page: RepositoryHistoryPage,
  query: RepositoryHistoryQuery,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return updateStoredHistory(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const key = repositoryKey(environmentId, repositoryId);
    const current = await transaction.readRepository(key);
    const existingCommits = await Promise.all(
      page.commits.map((commit) =>
        transaction.readCommit(
          commitKey(environmentId, repositoryId, commit.oid),
        ),
      ),
    );
    for (const [index, commit] of page.commits.entries()) {
      transaction.storeCommit(
        storedCommit(
          environmentId,
          repositoryId,
          commit,
          topologicalPosition(existingCommits[index]),
        ),
      );
    }
    transaction.storeRepository({
      ...emptyStoredRepository(environmentId, repositoryId, page.objectFormat),
      ...current,
      ...cacheForegroundHistoryPage(current, page, query),
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

function cacheForegroundHistoryPage(
  current: StoredRepository | undefined,
  page: RepositoryHistoryPage,
  query: RepositoryHistoryQuery,
): Pick<StoredRepository, "cachedPage" | "foregroundPages"> {
  const cachedPage = {
    offset: query.offset ?? 0,
    exhausted: page.commits.length < query.limit,
    scopeKey: historyOrderScopeKey(query),
    oids: page.commits.map((commit) => commit.oid),
    order: query.order,
    requestedLimit: query.limit,
    rootOids: normalizedOids(page.refTargets.map((ref) => ref.oid)),
  };
  return cachedPage.offset === 0
    ? { cachedPage }
    : {
        foregroundPages: [
          ...(current?.foregroundPages ?? []).filter(
            (previous) =>
              previous.offset !== cachedPage.offset ||
              previous.scopeKey !== cachedPage.scopeKey ||
              JSON.stringify(previous.rootOids) !==
                JSON.stringify(cachedPage.rootOids),
          ),
          cachedPage,
        ].slice(-15),
      };
}

export function beginRepositoryHistorySynchronization(
  environmentId: string,
  repositoryId: string,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return updateStoredRepository(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const key = repositoryKey(environmentId, repositoryId);
    const current = await transaction.readRepository(key);
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
    transaction.storeRepository(
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
  return updateStoredRepository(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const key = repositoryKey(environmentId, repositoryId);
    const current = await transaction.readRepository(key);
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
    transaction.storeRepository({
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
  return updateStoredHistory(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const key = repositoryKey(environmentId, repositoryId);
    const current = await transaction.readRepository(key);
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
          transaction.readCommit(
            commitKey(environmentId, repositoryId, commit.oid),
          ),
        ),
      );
      for (const [offset, commit] of batch.commits.entries()) {
        const existing = existingCommits[offset];
        const position =
          (batch.snapshot ?? current.pendingSnapshot)?.resumable === true
            ? undefined
            : topologicalPosition(existing);
        transaction.storeCommit({
          ...existing,
          ...storedCommit(
            environmentId,
            repositoryId,
            commit,
            position ?? {
              epoch: topologicalEpoch,
              order: topologicalOrder + offset,
            },
          ),
        });
      }
      transaction.storeRepository({
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
  return updateStoredHistory(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const key = repositoryKey(environmentId, repositoryId);
    const current = await transaction.readRepository(key);
    if (current === undefined) {
      throw new Error("Repository history has no synchronization state");
    }
    const snapshot = current.pendingSnapshot;
    const completion = {
      ...completeRepositoryHistory(
        current.progress,
        reportedCommitCount,
        snapshot,
      ),
      commitCount: await transaction.countCommits(key),
    };
    const {
      pendingSnapshot: _,
      pendingTopologicalEpoch: __,
      pendingTopologicalOrder: ___,
      foregroundPages: _foregroundPages,
      cachedPage,
      ...withoutPendingSynchronization
    } = current;
    transaction.storeRepository({
      ...withoutPendingSynchronization,
      completion,
      ...(cachedPage === undefined
        ? {}
        : {
            cachedPage:
              snapshot !== undefined &&
              current.completion?.snapshot?.id === snapshot.id
                ? cachedPage
                : { ...cachedPage, exhausted: false },
          }),
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
  return readStoredRepository(environmentId, repositoryId, indexedDB).then(
    (repository) => {
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
    },
  );
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
      ...(repository.pendingSnapshot.shallowOids === undefined
        ? {}
        : { shallowOids: repository.pendingSnapshot.shallowOids }),
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
        ...(snapshot.shallowOids === undefined
          ? {}
          : { shallowOids: snapshot.shallowOids }),
        snapshotId: snapshot.id,
      };
}

function topologicalPosition(commit: StoredCommit | undefined) {
  return commit?.topologicalEpoch === undefined ||
    commit.topologicalOrder === undefined
    ? undefined
    : { epoch: commit.topologicalEpoch, order: commit.topologicalOrder };
}
