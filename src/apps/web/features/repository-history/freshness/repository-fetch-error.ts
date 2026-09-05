import {
  RepositoryHistoryOffline,
  RepositoryHistoryRejected,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";

export function describeRepositoryFetchError(error: unknown) {
  if (error instanceof RepositoryHistoryOffline)
    return "Reconnect to the server and try again.";
  if (error instanceof RepositoryHistoryUnavailable)
    return "Fetching is unavailable for this server.";
  if (error instanceof RepositoryHistoryRejected) {
    if (error.failure._tag === "AuthorizationDenied")
      return "You do not have permission to change this repository.";
    if (error.failure._tag === "RepositoryMissing")
      return "The repository is no longer available.";
  }
  return "Git could not complete the request. Try again.";
}
