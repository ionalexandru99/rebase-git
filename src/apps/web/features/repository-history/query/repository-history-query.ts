import type { RepositoryCommit } from "@rebase/contracts";
import { HistoryOrderIndex } from "#web/features/repository-history/query/history-order";
import type {
  HistoryOrderCache,
  HistoryOrderNode,
} from "#web/features/repository-history/query/history-order.contract";
import { selectHistoryPage } from "#web/features/repository-history/query/history-page-selection";
import { readStoredRepositoryHistoryState } from "#web/features/repository-history/replica/repository-history-store";
import type {
  RepositoryHistoryPosition,
  RepositoryHistoryQuery,
} from "#web/features/repository-history/repository-history-reader.contract";
import type { StoredCommit } from "#web/persistence/repository-history/repository-history-database.contract";
import {
  commitKey,
  repositoryKey,
} from "#web/persistence/repository-history/repository-history-records";
import type { RepositoryHistoryReadTransaction } from "#web/persistence/repository-history/repository-history-transaction.contract";
import {
  readStoredCommitChunk,
  readStoredCommits,
  readStoredHistory,
  readStoredRepository,
} from "#web/persistence/repository-history/repository-history-transactions";

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
  const revision = cache.revision;
  const roots = normalizedOids(query.roots.map(({ oid }) => oid));
  const key = historyOrderScopeKey(query);
  const previous = cache.queries.get(key);
  const index = cache.index;
  if (
    (index === undefined || roots.some((oid) => !index.has(oid))) &&
    (!previous?.complete ||
      previous.basis !== JSON.stringify([revision, roots]))
  ) {
    const known = await locateCachedHistoryPrefix(
      environmentId,
      repositoryId,
      roots,
      key,
      oids,
    );
    if (cache.revision !== revision) return [];
    if (known !== undefined) return known;
  }
  const ordered = await resolveRepositoryHistoryOrder(
    environmentId,
    repositoryId,
    query,
    cache,
  );
  if (ordered === undefined) return [];
  return locateInHistoryOrder(ordered, oids);
}

async function locateCachedHistoryPrefix(
  environmentId: string,
  repositoryId: string,
  roots: readonly string[],
  scopeKey: string,
  oids: readonly string[],
) {
  return readStoredRepository(environmentId, repositoryId).then(
    (repository) => {
      const page = repository?.cachedPage;
      if (
        page?.offset !== 0 ||
        page.scopeKey !== scopeKey ||
        !sameOids(roots, page.rootOids)
      )
        return undefined;
      const known = locateInHistoryOrder(page.oids, oids);
      return known.length === new Set(oids).size ? known : undefined;
    },
  );
}

function locateInHistoryOrder(
  ordered: readonly string[],
  oids: readonly string[],
) {
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
  if (previous?.complete && previous.basis === basis) return previous.oids;
  const index = cache.index;
  if (index !== undefined && roots.every((oid) => index.has(oid))) {
    const ordered = index.order(
      roots,
      query.order,
      previous?.oids,
      query.ancestry,
      query.additionalParentEdges,
    );
    rememberHistoryOrder(cache, key, { basis, oids: ordered, complete: true });
    return ordered;
  }
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
  const revision = orderCache.revision;
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
  return readStoredHistory(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const repository = await transaction.readRepository(
      repositoryKey(environmentId, repositoryId),
    );
    if (repository === undefined) {
      await completed;
      return undefined;
    }
    const roots = normalizedOids(query.roots.map((root) => root.oid));
    const storedRoots = await Promise.all(
      roots.map((oid) =>
        transaction.readCommit(commitKey(environmentId, repositoryId, oid)),
      ),
    );
    if (storedRoots.some((root) => root === undefined)) {
      await completed;
      return undefined;
    }
    const key = historyOrderScopeKey(query);
    const basis = JSON.stringify([revision, roots]);
    const previous = orderCache.queries.get(key);
    const cachedPage = [
      repository.cachedPage,
      ...(repository.foregroundPages ?? []),
    ].find(
      (page) =>
        page !== undefined &&
        query.order === page.order &&
        canSelectCachedHistoryPage(query, page.scopeKey) &&
        sameOids(roots, page.rootOids) &&
        offset >= (page.offset ?? 0) &&
        (offset + query.limit <= (page.offset ?? 0) + page.oids.length ||
          (page.exhausted ?? page.oids.length < page.requestedLimit)),
    );
    if (
      cachedPage !== undefined &&
      (query.ancestry !== "first-parent" ||
        repository.completion === undefined ||
        (cachedPage.offset === 0 && cachedPage.scopeKey === key)) &&
      (previous === undefined ||
        (!previous.complete && previous.basis === basis) ||
        (repository.completion === undefined &&
          cachedPage.offset !== undefined &&
          cachedPage.scopeKey === key &&
          offset + query.limit <= cachedPage.offset + cachedPage.oids.length))
    ) {
      const relativeOffset = offset - (cachedPage.offset ?? 0);
      const cachedOids = cachedPage.oids.slice(
        relativeOffset,
        relativeOffset + query.limit,
      );
      const result = await readCommitsByOid(
        transaction,
        environmentId,
        repositoryId,
        cachedOids,
      );
      if (result.length !== cachedOids.length)
        throw new Error("Repository history cache is incomplete");
      await completed;
      if (orderCache.revision !== revision) return undefined;
      const appliedQuery =
        cachedPage.offset !== undefined && cachedPage.scopeKey === key;
      const selected = appliedQuery ? result : selectHistoryPage(result, query);
      if (
        !appliedQuery &&
        selected.length < query.limit &&
        !(
          cachedPage.exhausted ??
          cachedPage.oids.length < cachedPage.requestedLimit
        ) &&
        hasMissingSelectedParents(selected, query)
      )
        return undefined;
      if ((cachedPage.offset ?? 0) === 0)
        rememberHistoryOrder(orderCache, key, {
          basis,
          oids:
            appliedQuery || query.ancestry !== "first-parent"
              ? cachedPage.oids
              : selected.map(({ oid }) => oid),
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
      await completed;
      if (orderCache.revision !== revision) return undefined;
      await prepareRepositoryHistoryOrder(
        environmentId,
        repositoryId,
        orderCache,
        indexedDB,
      );
      if (orderCache.revision !== revision || orderCache.index === undefined)
        return undefined;
      const cachedPrefix =
        (repository.cachedPage?.offset ?? 0) === 0 &&
        repository.cachedPage?.order === query.order &&
        (repository.cachedPage.scopeKey === key ||
          (repository.cachedPage.scopeKey === undefined &&
            query.ancestry !== "first-parent" &&
            (query.additionalParentEdges?.length ?? 0) === 0 &&
            sameOids(roots, repository.cachedPage.rootOids)))
          ? repository.cachedPage.oids
          : undefined;
      const prepared = orderCache.queries.get(key);
      ordered =
        prepared?.complete && prepared.basis === basis
          ? prepared.oids
          : orderCache.index.order(
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
      const result = await readRepositoryCommits(
        environmentId,
        repositoryId,
        ordered.slice(offset, offset + query.limit),
        indexedDB,
      );
      return orderCache.revision === revision ? result : undefined;
    }
    const result = await readCommitsByOid(
      transaction,
      environmentId,
      repositoryId,
      ordered.slice(offset, offset + query.limit),
    );
    await completed;
    return orderCache.revision === revision ? result : undefined;
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
  return readStoredCommits(environmentId, repositoryId, oids, indexedDB).then(
    (records) =>
      records.flatMap((record) =>
        record === undefined ? [] : [record.commit],
      ),
  );
}

function readCommitsByOid(
  transaction: RepositoryHistoryReadTransaction,
  environmentId: string,
  repositoryId: string,
  oids: readonly string[],
) {
  return Promise.all(
    oids.map((oid) =>
      transaction.readCommit(commitKey(environmentId, repositoryId, oid)),
    ),
  ).then((records) =>
    records.flatMap((record) => (record === undefined ? [] : [record.commit])),
  );
}

async function readHistoryOrderNodes(
  readChunk: (after: string | undefined) => Promise<StoredCommit[]>,
) {
  let after: string | undefined;
  const result: (HistoryOrderNode & { epoch: number; order: number })[] = [];
  while (true) {
    const records = await readChunk(after);
    for (const record of records) {
      const epoch = record.topologicalEpoch;
      const order = record.topologicalOrder;
      if (
        epoch === undefined ||
        order === undefined ||
        !Number.isSafeInteger(epoch) ||
        !Number.isSafeInteger(order)
      )
        continue;
      result.push({
        oid: record.commit.oid,
        parents: record.commit.parents,
        timestamp: record.commit.committer.timestampSeconds,
        epoch,
        order,
      });
    }
    const last = records.at(-1);
    if (records.length < 2_048 || last === undefined) break;
    after = last.key;
  }
  return result.sort(
    (left, right) =>
      left.epoch - right.epoch ||
      left.order - right.order ||
      (left.oid < right.oid ? -1 : left.oid > right.oid ? 1 : 0),
  );
}

export function prepareRepositoryHistoryOrder(
  environmentId: string,
  repositoryId: string,
  cache: HistoryOrderCache,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
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
    indexedDB,
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
  indexedDB: IDBFactory | undefined,
) {
  const nodes = await readHistoryOrderNodes((after) =>
    readStoredCommitChunk(
      repositoryKey(environmentId, repositoryId),
      after,
      2_048,
      indexedDB,
      () => revision === cache.revision,
    ),
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

function hasMissingSelectedParents(
  commits: readonly RepositoryCommit[],
  query: RepositoryHistoryQuery,
) {
  const available = new Set(commits.map(({ oid }) => oid));
  if (query.roots.some(({ oid }) => !available.has(oid))) return true;
  return commits.some((commit) => {
    const parents =
      query.ancestry === "first-parent"
        ? commit.parents.slice(0, 1)
        : commit.parents;
    return (
      parents.some((oid) => !available.has(oid)) ||
      query.additionalParentEdges?.some(
        ({ childOid, parentOid }) =>
          childOid === commit.oid && !available.has(parentOid),
      )
    );
  });
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
