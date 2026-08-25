import type { EnvironmentDirectoryEntry } from "@rebase/contracts";
import { RepositoryCatalogRejected } from "#web/features/repository-catalog/repository-catalog-client.contract";

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

export function repositorySelectionError(error: unknown) {
  if (
    error instanceof RepositoryCatalogRejected &&
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
