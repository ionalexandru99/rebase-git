import type { RepositoryCommit } from "@rebase/contracts";

export interface RepositoryHistorySearchQuery {
  readonly text: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface RepositoryHistorySearchResult {
  readonly commits: readonly RepositoryCommit[];
  readonly nextCursor?: string;
  readonly replicaComplete: boolean;
  readonly synchronizedCommitCount: number;
}

export interface RepositoryHistorySearch {
  readonly search: (
    query: RepositoryHistorySearchQuery,
    signal?: AbortSignal,
  ) => Promise<RepositoryHistorySearchResult>;
}
