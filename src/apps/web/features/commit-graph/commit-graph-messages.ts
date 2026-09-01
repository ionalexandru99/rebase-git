import type { RepositoryHistoryReaderError } from "#web/features/repository-history/repository-history-reader.contract";

export function describeRepositoryHistoryError(
  error: RepositoryHistoryReaderError,
) {
  if (error._tag === "RepositoryHistoryUnavailable") {
    return "Commit history is unavailable while the Environment reconnects.";
  }
  switch (error.failure._tag) {
    case "AuthorizationDenied":
      return "This device cannot read repository history.";
    case "RepositoryMissing":
      return "The repository is no longer known by this Environment.";
    case "GitFailed":
      return (
        error.failure.detail?.trim() || "Git could not read commit history."
      );
  }
}
