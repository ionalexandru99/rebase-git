import type { RepositoryCommit } from "@rebase/contracts";
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
import { withHistorySearchRecords } from "#web/persistence/repository-history/repository-history-search-records";
import type { RepositoryHistorySearchRecords } from "#web/persistence/repository-history/repository-history-transaction.contract";

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
  try {
    return await withHistorySearchRecords(
      environmentId,
      repositoryId,
      indexedDB,
      (records) =>
        searchHistoryPage(environmentId, repositoryId, query, records, signal),
    );
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}

async function searchHistoryPage(
  environmentId: string,
  repositoryId: string,
  query: RepositoryHistorySearchQuery,
  records: RepositoryHistorySearchRecords,
  signal?: AbortSignal,
): Promise<RepositoryHistorySearchResult> {
  let after = decodeHistorySearchCursor(
    environmentId,
    repositoryId,
    query.text,
    query.cursor,
  );
  const state = await records.readRepository();
  signal?.throwIfAborted();
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
    const chunk = await records.readChunk(after, chunkSize);
    signal?.throwIfAborted();
    if (chunk.length === 0) return { ...result, commits };
    for (const record of chunk) {
      after = record.commit.oid;
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
