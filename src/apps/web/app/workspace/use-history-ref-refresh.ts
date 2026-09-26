import { useEffect } from "react";
import type { RepositoryHistoryObservation } from "#web/features/repository-history/repository-history-reader";

export function useHistoryRefRefresh(
  reader: RepositoryHistoryObservation | undefined,
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
