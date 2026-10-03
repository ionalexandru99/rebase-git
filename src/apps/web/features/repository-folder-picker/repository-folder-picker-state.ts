import type {
  EnvironmentDirectoryEntry,
  EnvironmentDirectoryRejected,
  EnvironmentFilesystemApi,
} from "#contracts/environment-filesystem/environment-filesystem.contract.ts";
import type {
  RepositoryCatalogApi,
  RepositoryPathRejected,
} from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type { QueryFailure } from "#web/platform/query/environment-query.ts";
import {
  describeFailure,
  rejection,
} from "#web/platform/query/request-failure.ts";
import type { CommandFailure } from "#web/platform/query/use-command.ts";

export function childPath(folder: string, name: string) {
  const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return folder.endsWith(separator)
    ? `${folder}${name}`
    : `${folder}${separator}${name}`;
}

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

const pathProblems: Record<RepositoryPathRejected["reason"], string> = {
  NotRepository: "This folder is not a Git repository.",
  NotFound: "This folder no longer exists.",
  NotDirectory: "The selected path is not a folder.",
  InspectionFailed: "Rebase could not inspect this folder.",
  MalformedPath: "The selected folder path is invalid.",
};

const directoryProblems: Record<
  EnvironmentDirectoryRejected["reason"],
  string
> = {
  NotFound: "This folder no longer exists.",
  NotDirectory: "This path is not a folder.",
  PermissionDenied: "Rebase does not have permission to open this folder.",
  MalformedPath: "This folder path is invalid.",
  InspectionFailed: "Rebase could not read this folder.",
};

export function repositorySelectionError(
  failure: CommandFailure<typeof RepositoryCatalogApi.remember>,
) {
  const rejected = rejection(failure);
  return rejected?._tag === "RepositoryPathRejected"
    ? pathProblems[rejected.reason]
    : undefined;
}

export function directoryListingError(
  failure: QueryFailure<typeof EnvironmentFilesystemApi.listDirectory>,
) {
  return describeFailure(failure, {
    EnvironmentDirectoryRejected: ({ reason }) => directoryProblems[reason],
  });
}
