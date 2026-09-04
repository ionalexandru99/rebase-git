import type {
  RepositoryCommit,
  RepositoryHistoryBatch,
  RepositoryHistoryPage,
  RepositoryHistoryRefTarget,
  RepositoryHistorySnapshot,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { HistoryOrderIndex } from "#web/features/repository-history/history-order";
import type {
  HistoryOrderCache,
  HistoryOrderNode,
} from "#web/features/repository-history/history-order.contract";
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
  repositoryOrderIndexName,
  repositoryStoreName,
  requestResult,
  type StoredCommit,
  type StoredRepository,
  storedCommit,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/features/repository-history/repository-history-database";
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

export function readRepositoryHistory(
  environmentId: string,
  repositoryId: string,
  query: RepositoryHistoryQuery,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
  orderCache: HistoryOrderCache = { queries: new Map(), revision: 0 },
): Promise<readonly RepositoryCommit[] | undefined> {
  const offset = query.offset ?? 0;
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 1_000
  ) {
    return Promise.reject(
      new Error("History query is outside the supported range"),
    );
  }
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(
      [commitStoreName, repositoryStoreName],
      "readonly",
    );
    const completed = transactionCompleted(transaction);
    const commits = transaction.objectStore(commitStoreName);
    const repository = await requestResult<StoredRepository | undefined>(
      transaction
        .objectStore(repositoryStoreName)
        .get(repositoryKey(environmentId, repositoryId)),
    );
    if (repository === undefined) {
      await completed;
      return undefined;
    }
    const roots = normalizedOids(query.roots.map((root) => root.oid));
    const storedRoots = await Promise.all(
      roots.map((oid) =>
        requestResult<StoredCommit | undefined>(
          commits.get(commitKey(environmentId, repositoryId, oid)),
        ),
      ),
    );
    if (storedRoots.some((root) => root === undefined)) {
      await completed;
      return undefined;
    }
    if (
      query.order === repository.cachedPage?.order &&
      sameOids(roots, repository.cachedPage.rootOids) &&
      (offset + query.limit <= repository.cachedPage.oids.length ||
        repository.cachedPage.oids.length <
          repository.cachedPage.requestedLimit)
    ) {
      const cachedOids = repository.cachedPage.oids.slice(
        offset,
        offset + query.limit,
      );
      const result = await readCommitsByOid(
        commits,
        environmentId,
        repositoryId,
        cachedOids,
      );
      if (result.length !== cachedOids.length) {
        throw new Error("Repository history cache is incomplete");
      }
      await completed;
      return result;
    }
    if (repository.completion === undefined) {
      await completed;
      return undefined;
    }
    const key = JSON.stringify([
      query.order,
      query.roots.map(({ name, type }) => [name, type]).sort(),
    ]);
    const basis = JSON.stringify([orderCache.revision, roots]);
    const previous = orderCache.queries.get(key);
    let ordered = previous?.basis === basis ? previous.oids : undefined;
    if (ordered === undefined) {
      orderCache.index ??= new HistoryOrderIndex(
        await readHistoryOrderNodes(
          commits.index(repositoryOrderIndexName),
          environmentId,
          repositoryId,
        ),
      );
      const cachedPrefix =
        repository.cachedPage?.order === query.order
          ? repository.cachedPage.oids
          : undefined;
      ordered = orderCache.index.order(
        roots,
        query.order,
        previous?.oids ?? cachedPrefix,
      );
      if (orderCache.queries.size >= 4) {
        const oldest = orderCache.queries.keys().next().value;
        if (oldest !== undefined) orderCache.queries.delete(oldest);
      }
      orderCache.queries.set(key, { basis, oids: ordered });
    }
    const result = await readCommitsByOid(
      commits,
      environmentId,
      repositoryId,
      ordered.slice(offset, offset + query.limit),
    );
    await completed;
    return result;
  });
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

export function readRepositoryCommits(
  environmentId: string,
  repositoryId: string,
  oids: readonly string[],
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  if (oids.length > 1_000) {
    return Promise.reject(new Error("Query is too large"));
  }
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(commitStoreName, "readonly");
    const completed = transactionCompleted(transaction);
    const records = await readCommitsByOid(
      transaction.objectStore(commitStoreName),
      environmentId,
      repositoryId,
      oids,
    );
    await completed;
    return records;
  });
}

function readCommitsByOid(
  store: IDBObjectStore,
  environmentId: string,
  repositoryId: string,
  oids: readonly string[],
) {
  return Promise.all(
    oids.map((oid) =>
      requestResult<StoredCommit | undefined>(
        store.get(commitKey(environmentId, repositoryId, oid)),
      ),
    ),
  ).then((records) =>
    records.flatMap((record) => (record === undefined ? [] : [record.commit])),
  );
}

async function readHistoryOrderNodes(
  index: IDBIndex,
  environmentId: string,
  repositoryId: string,
) {
  let lower = [environmentId, repositoryId, Number.MIN_SAFE_INTEGER, 0];
  const upper = [
    environmentId,
    repositoryId,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  ];
  let open = false;
  const result: HistoryOrderNode[] = [];
  while (true) {
    const records = await requestResult<StoredCommit[]>(
      index.getAll(IDBKeyRange.bound(lower, upper, open), 2_048),
    );
    for (const record of records) {
      result.push({
        oid: record.commit.oid,
        parents: record.commit.parents,
        timestamp: record.commit.committer.timestampSeconds,
      });
    }
    const last = records.at(-1);
    if (
      records.length < 2_048 ||
      last?.topologicalEpoch === undefined ||
      last.topologicalOrder === undefined
    )
      return result;
    lower = [
      environmentId,
      repositoryId,
      last.topologicalEpoch,
      last.topologicalOrder,
    ];
    open = true;
  }
}

export async function prepareRepositoryHistoryOrder(
  environmentId: string,
  repositoryId: string,
  cache: HistoryOrderCache,
) {
  const revision = cache.revision;
  const nodes = await withRepositoryHistoryDatabase(
    globalThis.indexedDB,
    async (database) => {
      const transaction = database.transaction(commitStoreName, "readonly");
      const completed = transactionCompleted(transaction);
      const nodes = await readHistoryOrderNodes(
        transaction
          .objectStore(commitStoreName)
          .index(repositoryOrderIndexName),
        environmentId,
        repositoryId,
      );
      await completed;
      return nodes;
    },
  );
  if (revision === cache.revision) cache.index = new HistoryOrderIndex(nodes);
}

function normalizedOids(oids: readonly string[]) {
  return [...new Set(oids)].sort();
}

function sameOids(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((oid, index) => oid === right[index])
  );
}

function topologicalPosition(commit: StoredCommit | undefined) {
  return commit?.topologicalEpoch === undefined ||
    commit.topologicalOrder === undefined
    ? undefined
    : { epoch: commit.topologicalEpoch, order: commit.topologicalOrder };
}
