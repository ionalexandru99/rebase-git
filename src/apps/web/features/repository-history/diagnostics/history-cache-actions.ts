import type { RepositoryHistoryCacheAction } from "#web/features/repository-history/repository-history-storage.contract";
export const historyCacheActions: Record<
  RepositoryHistoryCacheAction,
  { label: string; description: string; result: string }
> = {
  clear: {
    label: "Clear cache",
    description:
      "Clear this repository’s cached history and pause synchronization. Rebuild or reopen the repository to load history.",
    result: "Cache cleared. Rebuild or reopen the repository to load history.",
  },
  rebuild: {
    label: "Rebuild cache",
    description:
      "Clear this repository’s cached history and download it again. The environment must be connected.",
    result: "Cache rebuild requested.",
  },
  remove: {
    label: "Remove cache",
    description:
      "Remove this repository’s cached history and close its history readers. Reopen the repository to download history again.",
    result: "Cache removed. Reopen the repository to load history.",
  },
  "clear-all": {
    label: "Clear all caches",
    description:
      "Clear cached history for every repository, including open repositories. Rebuild or reopen a repository to load its history.",
    result:
      "All history caches cleared. Rebuild or reopen a repository to load history.",
  },
};
