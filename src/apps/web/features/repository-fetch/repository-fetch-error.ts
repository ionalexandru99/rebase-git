import {
  RepositoryHistoryOffline,
  RepositoryHistoryRejected,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader";
import { describeFailure } from "#web/platform/query/request-failure";

export function describeRepositoryFetchError(error: unknown) {
  if (error instanceof RepositoryHistoryOffline)
    return describeFailure({ _tag: "Unanswered" });
  if (error instanceof RepositoryHistoryUnavailable)
    return "Fetching is unavailable for this server.";
  if (error instanceof RepositoryHistoryRejected)
    return describeFailure({ _tag: "Rejected", failure: error.failure });
  return "Git could not complete the operation.";
}
