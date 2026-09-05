import type { RepositoryCommit } from "@rebase/contracts";
import { HistoryOrderIndex } from "#web/features/repository-history/history-order";
import type {
  HistoryOrderCache,
  HistoryOrderNode,
} from "#web/features/repository-history/history-order.contract";
import { selectHistoryPage } from "#web/features/repository-history/history-page-selection";
import {
  commitKey,
  commitStoreName,
  repositoryKey,
  repositoryOrderIndexName,
  repositoryStoreName,
  requestResult,
  type StoredCommit,
  type StoredRepository,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/features/repository-history/repository-history-database";
import type {
  RepositoryHistoryPosition,
  RepositoryHistoryQuery,
} from "#web/features/repository-history/repository-history-reader.contract";
import { readStoredRepositoryHistoryState } from "#web/features/repository-history/repository-history-store";

export async function locateRepositoryHistoryCommit(
  environmentId: string,
  repositoryId: string,
  query: RepositoryHistoryQuery,
  oid: string,
  cache: HistoryOrderCache,
): Promise<number | undefined> {
  return (
    await locateRepositoryHistoryCommits(
      environmentId,
      repositoryId,
      query,
      [oid],
      cache,
    )
  )[0]?.index;
}

export async function locateRepositoryHistoryCommits(
  environmentId: string,
  repositoryId: string,
  query: RepositoryHistoryQuery,
  oids: readonly string[],
  cache: HistoryOrderCache,
): Promise<readonly RepositoryHistoryPosition[]> {
  if (oids.length > 1_000) throw new Error("Query is too large");
  if (oids.length === 0) return [];
  const ordered = await resolveRepositoryHistoryOrder(
    environmentId,
    repositoryId,
    query,
    cache,
  );
  if (ordered === undefined) return [];
  const remaining = new Set(oids);
  const result: RepositoryHistoryPosition[] = [];
  for (
    let index = 0;
    index < ordered.length && remaining.size > 0;
    index += 1
  ) {
    const oid = ordered[index];
    if (oid !== undefined && remaining.delete(oid)) result.push({ oid, index });
  }
  return result;
}

async function resolveRepositoryHistoryOrder(
  environmentId: string,
  repositoryId: string,
  query: RepositoryHistoryQuery,
  cache: HistoryOrderCache,
): Promise<readonly string[] | undefined> {
  const revision = cache.revision;
  const key = historyOrderScopeKey(query);
  const roots = normalizedOids(query.roots.map(({ oid }) => oid));
  const basis = JSON.stringify([revision, roots]);
  let previous = cache.queries.get(key);
  if (previous?.basis !== basis) {
    const page = await readRepositoryHistory(
      environmentId,
      repositoryId,
      { ...query, offset: 0, limit: 1_000 },
      globalThis.indexedDB,
      cache,
    );
    if (page === undefined || cache.revision !== revision) return undefined;
    previous = cache.queries.get(key);
  }
  if (previous === undefined) return undefined;
  let ordered = previous.oids;
  if (
    !previous.complete &&
    (await readStoredRepositoryHistoryState(environmentId, repositoryId))
      ?.completion !== undefined
  ) {
    if (cache.index === undefined)
      await prepareRepositoryHistoryOrder(environmentId, repositoryId, cache);
    if (cache.revision !== revision || cache.index === undefined)
      return undefined;
    ordered = cache.index.order(
      roots,
      query.order,
      previous.oids,
      query.ancestry,
      query.additionalParentEdges,
    );
    rememberHistoryOrder(cache, key, {
      basis: previous.basis,
      oids: ordered,
      complete: true,
    });
  }
  return cache.revision === revision ? ordered : undefined;
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
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(offset + query.limit) ||
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
    const key = historyOrderScopeKey(query);
    const basis = JSON.stringify([orderCache.revision, roots]);
    const previous = orderCache.queries.get(key);
    if (
      (query.ancestry !== "first-parent" ||
        (repository.completion === undefined && offset === 0)) &&
      (previous === undefined ||
        (!previous.complete && previous.basis === basis)) &&
      query.order === repository.cachedPage?.order &&
      canSelectCachedHistoryPage(query, repository.cachedPage.scopeKey) &&
      sameOids(roots, repository.cachedPage.rootOids) &&
      (offset + query.limit <= repository.cachedPage.oids.length ||
        (repository.cachedPage.exhausted ??
          repository.cachedPage.oids.length <
            repository.cachedPage.requestedLimit))
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
      const selected = selectHistoryPage(result, query);
      rememberHistoryOrder(orderCache, key, {
        basis,
        oids:
          query.ancestry === "first-parent"
            ? selected.map(({ oid }) => oid)
            : repository.cachedPage.oids,
        complete: false,
      });
      return selected;
    }
    if (repository.completion === undefined) {
      await completed;
      return undefined;
    }
    let ordered =
      previous?.complete && previous.basis === basis
        ? previous.oids
        : undefined;
    if (ordered === undefined) {
      orderCache.index ??= new HistoryOrderIndex(
        await readHistoryOrderNodes(
          (range) =>
            requestResult<StoredCommit[]>(
              commits.index(repositoryOrderIndexName).getAll(range, 2_048),
            ),
          environmentId,
          repositoryId,
        ),
      );
      const cachedPrefix =
        repository.cachedPage?.order === query.order &&
        (repository.cachedPage.scopeKey === key ||
          (repository.cachedPage.scopeKey === undefined &&
            query.ancestry !== "first-parent" &&
            (query.additionalParentEdges?.length ?? 0) === 0 &&
            sameOids(roots, repository.cachedPage.rootOids)))
          ? repository.cachedPage.oids
          : undefined;
      ordered = orderCache.index.order(
        roots,
        query.order,
        previous?.oids ?? cachedPrefix,
        query.ancestry,
        query.additionalParentEdges,
      );
      rememberHistoryOrder(orderCache, key, {
        basis,
        oids: ordered,
        complete: true,
      });
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
  readChunk: (range: IDBKeyRange) => Promise<StoredCommit[]>,
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
    const records = await readChunk(IDBKeyRange.bound(lower, upper, open));
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

export function prepareRepositoryHistoryOrder(
  environmentId: string,
  repositoryId: string,
  cache: HistoryOrderCache,
) {
  if (cache.index !== undefined) return Promise.resolve();
  if (cache.preparation?.revision === cache.revision)
    return cache.preparation.task;
  const revision = cache.revision;
  const task = buildRepositoryHistoryOrder(
    environmentId,
    repositoryId,
    cache,
    revision,
  ).finally(() => {
    if (cache.preparation?.task === task) delete cache.preparation;
  });
  cache.preparation = { revision, task };
  return task;
}

async function buildRepositoryHistoryOrder(
  environmentId: string,
  repositoryId: string,
  cache: HistoryOrderCache,
  revision: number,
) {
  const nodes = await readHistoryOrderNodes(
    (range) =>
      withRepositoryHistoryDatabase(globalThis.indexedDB, async (database) => {
        if (revision !== cache.revision) return [];
        const transaction = database.transaction(commitStoreName, "readonly");
        const completed = transactionCompleted(transaction);
        const nodes = await requestResult<StoredCommit[]>(
          transaction
            .objectStore(commitStoreName)
            .index(repositoryOrderIndexName)
            .getAll(range, 2_048),
        );
        await completed;
        return nodes;
      }),
    environmentId,
    repositoryId,
  );
  if (revision === cache.revision) cache.index = new HistoryOrderIndex(nodes);
}

export function normalizedOids(oids: readonly string[]) {
  return [...new Set(oids)].sort();
}

export function historyOrderScopeKey(
  query: Pick<
    RepositoryHistoryQuery,
    "order" | "roots" | "ancestry" | "additionalParentEdges"
  >,
) {
  return JSON.stringify([
    query.order,
    query.ancestry ?? "all",
    (query.additionalParentEdges ?? [])
      .map(({ childOid, parentOid }) => `${childOid}\0${parentOid}`)
      .toSorted(),
    query.roots
      .map(({ name, type, oid }) =>
        type === "head" ? [name, type, oid] : [name, type],
      )
      .sort(),
  ]);
}

function canSelectCachedHistoryPage(
  query: RepositoryHistoryQuery,
  scopeKey: string | undefined,
) {
  if (scopeKey === historyOrderScopeKey(query)) return true;
  if ((query.additionalParentEdges?.length ?? 0) > 0) return false;
  if (query.ancestry !== "first-parent") return scopeKey === undefined;
  if ((query.offset ?? 0) !== 0) return false;
  if (scopeKey === undefined) return true;
  try {
    const stored: unknown = JSON.parse(scopeKey);
    return (
      Array.isArray(stored) &&
      ((stored.length === 2 && Array.isArray(stored[1])) ||
        (stored[1] === "all" &&
          Array.isArray(stored[2]) &&
          stored[2].length === 0))
    );
  } catch {
    return false;
  }
}

function sameOids(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((oid, index) => oid === right[index])
  );
}

function rememberHistoryOrder(
  cache: HistoryOrderCache,
  key: string,
  entry: {
    readonly basis: string;
    readonly oids: readonly string[];
    readonly complete: boolean;
  },
) {
  cache.queries.delete(key);
  if (cache.queries.size >= 4) {
    const oldest = cache.queries.keys().next().value;
    if (oldest !== undefined) cache.queries.delete(oldest);
  }
  cache.queries.set(key, entry);
}
