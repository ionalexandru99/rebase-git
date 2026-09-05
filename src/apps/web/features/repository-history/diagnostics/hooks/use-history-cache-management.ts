import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { RepositoryHistoryCacheProps } from "#web/features/repository-history/diagnostics/history-cache.contract";
import { historyCacheActions } from "#web/features/repository-history/diagnostics/history-cache-actions";
import type {
  RepositoryHistoryCacheAction,
  RepositoryHistoryStorageDiagnostics,
} from "#web/features/repository-history/repository-history-storage.contract";

export function useHistoryCacheManagement({
  reader,
  identity,
  onCacheChanged,
}: Pick<
  RepositoryHistoryCacheProps,
  "reader" | "identity" | "onCacheChanged"
>) {
  const snapshot = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const [diagnostics, setDiagnostics] =
    useState<RepositoryHistoryStorageDiagnostics>();
  const [confirmation, setConfirmation] =
    useState<RepositoryHistoryCacheAction>();
  const [pending, setPending] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      setDiagnostics(await reader.getCacheDiagnostics());
    } catch {
      setError("Unable to read history storage. Try refreshing.");
    }
  }, [reader]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const synchronized = snapshot.synchronization === "complete";
  useEffect(() => {
    if (synchronized) void refresh();
  }, [refresh, synchronized]);

  async function manage(action: RepositoryHistoryCacheAction) {
    setConfirmation(undefined);
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await reader.manageCache(action);
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
  const storageUnavailable =
    snapshot.error?._tag === "RepositoryHistoryStorageUnavailable";
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
