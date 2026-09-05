import { useEffect } from "react";
import type { RepositoryHistoryReader } from "#web/features/repository-history/repository-history-reader.contract";

export function useHistoryRefRefresh(
  reader:
    | Pick<RepositoryHistoryReader, "getSnapshot" | "subscribe">
    | undefined,
  connected: boolean,
  refresh: () => void,
) {
  useEffect(() => {
    if (reader === undefined || !connected) return;
    let completedRevision = reader.getSnapshot().historyRevision;
    return reader.subscribe(() => {
      const snapshot = reader.getSnapshot();
      if (
        snapshot.synchronization !== "complete" ||
        snapshot.historyRevision === completedRevision
      )
        return;
      completedRevision = snapshot.historyRevision;
      refresh();
    });
  }, [connected, reader, refresh]);
}
