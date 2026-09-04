import type { RepositoryCommit } from "@rebase/contracts";
import {
  commitStoreName,
  repositoryKey,
  repositorySearchIndexName,
  repositoryStoreName,
  requestResult,
  type StoredCommit,
  type StoredRepository,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/features/repository-history/repository-history-database";
import {
  matchingHistoryMetadata,
  normalizeHistorySearch,
} from "#web/features/repository-history/search/history-metadata-search";
import {
  decodeHistorySearchCursor,
  encodeHistorySearchCursor,
} from "#web/features/repository-history/search/history-search-cursor";
import type {
  RepositoryHistorySearchQuery,
  RepositoryHistorySearchResult,
} from "#web/features/repository-history/search/repository-history-search.contract";

const maximumScannedCommits = 4_096;
const chunkSize = 256;

export async function searchStoredRepositoryHistory(
  environmentId: string,
  repositoryId: string,
  query: RepositoryHistorySearchQuery,
  signal?: AbortSignal,
  indexedDB = globalThis.indexedDB,
): Promise<RepositoryHistorySearchResult> {
  if (
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100 ||
    query.text.length > 256
  )
    throw new Error("History search query exceeds its limits");
  signal?.throwIfAborted();
  let after = decodeHistorySearchCursor(
    environmentId,
    repositoryId,
    query.text,
    query.cursor,
  );
  const state = await readSearchState(environmentId, repositoryId, indexedDB);
  const result = {
    replicaComplete:
      state?.completion !== undefined && state.pendingSnapshot === undefined,
    synchronizedCommitCount: state?.progress.committedCommitCount ?? 0,
  };
  if (normalizeHistorySearch(query.text) === "")
    return { ...result, commits: [] };
  const matches = matchingHistoryMetadata(query.text, state?.refTargets ?? []);
  const commits: RepositoryCommit[] = [];
  let scanned = 0;
  while (scanned < maximumScannedCommits && commits.length < query.limit) {
    signal?.throwIfAborted();
    const chunk = await readSearchChunk(
      environmentId,
      repositoryId,
      after,
      indexedDB,
    );
    signal?.throwIfAborted();
    if (chunk.length === 0) return { ...result, commits };
    for (const record of chunk) {
      after = [record.commit.committer.timestampSeconds, record.commit.oid];
      scanned += 1;
      if (matches(record.commit)) commits.push(record.commit);
      if (commits.length === query.limit) break;
    }
    if (chunk.length < chunkSize && commits.length < query.limit)
      return { ...result, commits };
  }
  return {
    ...result,
    commits,
    ...(after === undefined
      ? {}
      : {
          nextCursor: encodeHistorySearchCursor(
            environmentId,
            repositoryId,
            query.text,
            after,
          ),
        }),
  };
}

function readSearchState(
  environmentId: string,
  repositoryId: string,
  indexedDB: IDBFactory,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readonly");
    const completed = transactionCompleted(transaction);
    const state = await requestResult<StoredRepository | undefined>(
      transaction
        .objectStore(repositoryStoreName)
        .get(repositoryKey(environmentId, repositoryId)),
    );
    await completed;
    return state;
  });
}

function readSearchChunk(
  environmentId: string,
  repositoryId: string,
  after: readonly [number, string] | undefined,
  indexedDB: IDBFactory,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(commitStoreName, "readonly");
    const completed = transactionCompleted(transaction);
    const range = IDBKeyRange.bound(
      [environmentId, repositoryId, Number.MIN_SAFE_INTEGER, ""],
      [
        environmentId,
        repositoryId,
        ...(after ?? [Number.MAX_SAFE_INTEGER, "\uffff"]),
      ],
      false,
      after !== undefined,
    );
    const records = await readCursorChunk(
      transaction
        .objectStore(commitStoreName)
        .index(repositorySearchIndexName)
        .openCursor(range, "prev"),
    );
    await completed;
    return records;
  });
}

function readCursorChunk(request: IDBRequest<IDBCursorWithValue | null>) {
  return new Promise<StoredCommit[]>((resolve, reject) => {
    const records: StoredCommit[] = [];
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) {
        resolve(records);
        return;
      }
      records.push(cursor.value as StoredCommit);
      if (records.length === chunkSize) {
        resolve(records);
        return;
      }
      cursor.continue();
    };
  });
}
