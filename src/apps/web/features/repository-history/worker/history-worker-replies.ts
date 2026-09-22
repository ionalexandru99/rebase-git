import type {
  RepositoryHistoryWorkerReplies,
  RepositoryHistoryWorkerResponse,
} from "#web/features/repository-history/worker/repository-history-worker.contract";

const replyTags = {
  LocateHistoryCommits: "HistoryPositionsResult",
  GetAncestryRoute: "AncestryRouteResult",
  LocateHistoryCommit: "HistoryPositionResult",
  FetchHistory: "FreshnessResult",
  ConfigureFetch: "FreshnessResult",
  SearchHistory: "HistorySearchResult",
  GetCacheDiagnostics: "CacheDiagnosticsResult",
  ManageCache: "CacheManaged",
  GetCommitSummaries: "CommitSummariesResult",
  GetRefTargets: "RefTargetsResult",
  ReadHistory: "HistoryResult",
} satisfies {
  readonly [Query in keyof RepositoryHistoryWorkerReplies]: RepositoryHistoryWorkerReplies[Query]["_tag"];
};

export function isHistoryWorkerReply<
  Query extends keyof RepositoryHistoryWorkerReplies,
>(
  query: Query,
  response: RepositoryHistoryWorkerResponse,
): response is RepositoryHistoryWorkerReplies[Query] {
  return response._tag === replyTags[query];
}
