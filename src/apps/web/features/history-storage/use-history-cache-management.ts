import { useCallback, useEffect, useState } from "react";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import type { HistoryStorage } from "#web/features/repository-history/history-worker-protocol.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { useStore } from "#web/platform/store/use-store.ts";

export type HistoryCacheAction = "clear" | "rebuild";

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
    identity: HistoryCacheIdentity,
  ) => void | Promise<void>;
}) {
  const snapshot = useStore(history);
  const [diagnostics, setDiagnostics] = useState<HistoryStorage>();
  const [confirmation, setConfirmation] = useState<HistoryCacheAction>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const errorToast = useErrorToast();
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
    const failure = action === "clear" ? "clearCache" : "rebuildCache";
    try {
      await history.ask({ _tag: "Storage", action });
      await refresh();
      try {
        await onCacheChanged(action, identity);
      } catch {
        errorToast.show(
          "refreshRepository",
          "The cache changed. Reopen the repository to update it.",
        );
      }
    } catch {
      errorToast.show(failure);
    }
    setPending(false);
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
    error,
    refresh,
    manage,
    exhausted,
    storageUnavailable,
  };
}

export const historyCacheActions: Record<
  HistoryCacheAction,
  { label: string; description: string }
> = {
  clear: {
    label: "Clear cache",
    description:
      "History stops syncing until you rebuild or reopen the repository.",
  },
  rebuild: {
    label: "Rebuild cache",
    description: "Download this repository's history again.",
  },
};
