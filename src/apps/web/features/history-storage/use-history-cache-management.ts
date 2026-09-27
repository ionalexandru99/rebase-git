import { useCallback, useEffect, useState } from "react";
import type {
  HistoryStorage,
  HistoryStorageAction,
} from "#web/features/repository-history/history-worker-protocol.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { useStore } from "#web/platform/store/use-store.ts";

export type HistoryCacheAction = Exclude<HistoryStorageAction, "inspect">;

export interface HistoryCacheIdentity {
  readonly environmentId: string;
  readonly repositoryId: string;
}

export function useHistoryCacheManagement({
  history,
  identity,
  onCacheChanged,
}: {
  readonly history: RepositoryHistory;
  readonly identity: HistoryCacheIdentity;
  readonly onCacheChanged: (
    action: HistoryCacheAction,
    identity?: HistoryCacheIdentity,
  ) => void | Promise<void>;
}) {
  const snapshot = useStore(history);
  const [diagnostics, setDiagnostics] = useState<HistoryStorage>();
  const [confirmation, setConfirmation] = useState<HistoryCacheAction>();
  const [pending, setPending] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      setDiagnostics(await history.ask({ _tag: "Storage", action: "inspect" }));
    } catch {
      setError("Unable to read history storage. Try refreshing.");
    }
  }, [history]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const synchronized = snapshot.synchronization === "complete";
  useEffect(() => {
    if (synchronized) void refresh();
  }, [refresh, synchronized]);

  async function manage(action: HistoryCacheAction) {
    setConfirmation(undefined);
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await history.ask({ _tag: "Storage", action });
      if (action === "remove") {
        setRemoved(true);
        setDiagnostics(
          (value) =>
            value && {
              ...value,
              caches: value.caches.filter(
                (cache) =>
                  cache.environmentId !== identity.environmentId ||
                  cache.repositoryId !== identity.repositoryId,
              ),
            },
        );
      }
      setMessage(historyCacheActions[action].result);
      if (action !== "remove") await refresh();
      try {
        await onCacheChanged(
          action,
          action === "clear-all" ? undefined : identity,
        );
      } catch {
        setError(
          "The cache changed, but the repository view could not refresh. Reopen the repository to update it.",
        );
      }
    } catch {
      setError(
        "The cache action could not finish. Refresh storage details and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  const exhausted =
    diagnostics?.usageBytes !== undefined &&
    diagnostics.quotaBytes !== undefined &&
    diagnostics.usageBytes >= diagnostics.quotaBytes;
  const storageUnavailable = snapshot.failure?._tag === "StorageUnavailable";
  return {
    snapshot,
    diagnostics,
    confirmation,
    setConfirmation,
    pending,
    removed,
    error,
    message,
    refresh,
    manage,
    exhausted,
    storageUnavailable,
  };
}

export const historyCacheActions: Record<
  HistoryCacheAction,
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
