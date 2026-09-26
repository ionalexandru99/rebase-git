import type {
  EnvironmentDirectoryEntry,
  EnvironmentFilesystemHttpApi,
  RepositoryCatalogHttpApi,
} from "@rebase/contracts";
import type { EnvironmentRouteFailure } from "@rebase/environment-client";
import type { CommandFailure } from "#web/platform/query/use-command";

export function filterDirectoryEntries(
  entries: readonly EnvironmentDirectoryEntry[],
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return entries;
  return entries.filter((entry) =>
    entry.name.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function modifiedDateLabel(
  modifiedAt: string | undefined,
  now = new Date(),
) {
  if (modifiedAt === undefined) return "—";
  const modified = new Date(modifiedAt);
  if (modified.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (modified.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(modified);
}

export function repositorySelectionError(
  error: CommandFailure<typeof RepositoryCatalogHttpApi.remember>,
) {
  if (
    error._tag === "EnvironmentHttpRejected" &&
    error.failure._tag === "RepositoryPathRejected"
  ) {
    switch (error.failure.reason) {
      case "NotRepository":
        return "This folder is not a Git repository.";
      case "NotFound":
        return "This folder no longer exists.";
      case "NotDirectory":
        return "The selected path is not a folder.";
      case "InspectionFailed":
        return "Rebase could not inspect this folder.";
      case "MalformedPath":
        return "The selected folder path is invalid.";
    }
  }
  return "Rebase could not open this repository.";
}

export function directoryListingError(
  error: EnvironmentRouteFailure<
    typeof EnvironmentFilesystemHttpApi.listDirectory
  >,
) {
  if (
    error._tag === "EnvironmentHttpRejected" &&
    error.failure._tag === "EnvironmentDirectoryRejected"
  ) {
    switch (error.failure.reason) {
      case "NotFound":
        return "This folder no longer exists.";
      case "NotDirectory":
        return "This path is not a folder.";
      case "PermissionDenied":
        return "Rebase does not have permission to open this folder.";
      case "MalformedPath":
        return "This folder path is invalid.";
      case "InspectionFailed":
        return "Rebase could not read this folder.";
    }
  }
  return "The Environment filesystem is unavailable.";
}
