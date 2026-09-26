import type {
  RepositoryCommit,
  RepositoryHistoryBatch,
  RepositoryHistoryPage,
  RepositoryHistoryRefTarget,
  RepositoryHistorySnapshot,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import type {
  RepositoryHistoryCompletionBasis,
  RepositoryHistorySynchronizationProgress,
} from "#web/domain/repository-history/repository-history-completion.contract";
import {
  historyOrderScopeKey,
  normalizedOids,
} from "#web/features/repository-history/query/history-query-scope";
import {
  acceptRepositoryHistoryBatch,
  completeRepositoryHistory,
} from "#web/features/repository-history/replica/repository-history-completion";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader";
import type {
  StoredCommit,
  StoredHistoryPage,
  StoredRepository,
} from "#web/persistence/repository-history/repository-history-database.contract";
import {
  emptyStoredRepository,
  storedCommit,
} from "#web/persistence/repository-history/repository-history-records";
import type { RepositoryHistoryReadTransaction } from "#web/persistence/repository-history/repository-history-transaction.contract";
import {
  readStoredRepository,
  updateStoredHistory,
  updateStoredRepository,
} from "#web/persistence/repository-history/repository-history-transactions";

type SynchronizationBasis = NonNullable<SynchronizeRepositoryHistory["basis"]>;

interface StoredRepositoryHistoryState {
  readonly completion?: RepositoryHistoryCompletionBasis;
  readonly objectFormat: "sha1" | "sha256";
  readonly refTargets: readonly RepositoryHistoryRefTarget[];
  readonly progress: RepositoryHistorySynchronizationProgress;
  readonly pendingSnapshot?: RepositoryHistorySnapshot;
}

export function storeRepositoryHistoryPage(
  environmentId: string,
  repositoryId: string,
  page: RepositoryHistoryPage,
  query: RepositoryHistoryQuery,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return updateStoredHistory(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const current = await transaction.readRepository(
      environmentId,
      repositoryId,
    );
    const existingCommits = await readExistingCommits(
      transaction,
      current,
      page.commits,
    );
    const repository = await transaction.storeRepository({
      ...emptyStoredRepository(environmentId, repositoryId, page.objectFormat),
      ...current,
      ...cacheForegroundHistoryPage(current, page, query),
      commitCount:
        (current?.commitCount ?? 0) + countAddedCommits(existingCommits),
      objectFormat: page.objectFormat,
      refTargets:
        current?.completion !== undefined ||
        current?.pendingSnapshot !== undefined
          ? current.refTargets
          : page.refTargets,
    });
    for (const [index, commit] of page.commits.entries()) {
      transaction.storeCommit(
        repository,
        storedCommit(commit, topologicalPosition(existingCommits[index])),
      );
    }
    await completed;
  });
}

function cacheForegroundHistoryPage(
  current: StoredRepository | undefined,
  page: RepositoryHistoryPage,
  query: RepositoryHistoryQuery,
): Pick<StoredRepository, "cachedPage" | "foregroundPages"> {
  const cachedPage: StoredHistoryPage = {
    offset: query.offset ?? 0,
    exhausted: page.commits.length < query.limit,
    scopeKey: historyOrderScopeKey(query),
    oids: page.commits.map((commit) => commit.oid),
    order: query.order,
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
    const current = await transaction.readRepository(
      environmentId,
      repositoryId,
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
    await transaction.storeRepository(
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

export function storeRepositoryHistoryBatch(
  environmentId: string,
  repositoryId: string,
  batch: RepositoryHistoryBatch,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return updateStoredHistory(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const current = await transaction.readRepository(
      environmentId,
      repositoryId,
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
      const minimumTopologicalEpoch = current.minimumTopologicalEpoch;
      const topologicalEpoch =
        batch.snapshot === undefined
          ? (current.pendingTopologicalEpoch ?? minimumTopologicalEpoch - 1)
          : minimumTopologicalEpoch - 1;
      const topologicalOrder =
        batch.snapshot === undefined
          ? (current.pendingTopologicalOrder ?? 0)
          : 0;
      const existingCommits = await readExistingCommits(
        transaction,
        current,
        batch.commits,
      );
      const resumable =
        (batch.snapshot ?? current.pendingSnapshot)?.resumable === true;
      for (const [offset, commit] of batch.commits.entries()) {
        const position = resumable
          ? undefined
          : topologicalPosition(existingCommits[offset]);
        transaction.storeCommit(
          current.id,
          storedCommit(
            commit,
            position ?? {
              epoch: topologicalEpoch,
              order: topologicalOrder + offset,
            },
          ),
        );
      }
      await transaction.storeRepository({
        ...current,
        commitCount: current.commitCount + countAddedCommits(existingCommits),
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
    const current = await transaction.readRepository(
      environmentId,
      repositoryId,
    );
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
      commitCount: current.commitCount,
    };
    const {
      pendingSnapshot: _,
      pendingTopologicalEpoch: __,
      pendingTopologicalOrder: ___,
      foregroundPages: _foregroundPages,
      cachedPage,
      ...withoutPendingSynchronization
    } = current;
    await transaction.storeRepository({
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

function readExistingCommits(
  transaction: RepositoryHistoryReadTransaction,
  repository: StoredRepository | undefined,
  commits: readonly RepositoryCommit[],
) {
  return repository === undefined
    ? commits.map(() => undefined)
    : Promise.all(
        commits.map((commit) =>
          transaction.readCommit(repository.id, commit.oid),
        ),
      );
}

function countAddedCommits(existing: readonly (StoredCommit | undefined)[]) {
  return existing.filter((commit) => commit === undefined).length;
}

function topologicalPosition(commit: StoredCommit | undefined) {
  return commit?.topologicalEpoch === undefined ||
    commit.topologicalOrder === undefined
    ? undefined
    : { epoch: commit.topologicalEpoch, order: commit.topologicalOrder };
}
