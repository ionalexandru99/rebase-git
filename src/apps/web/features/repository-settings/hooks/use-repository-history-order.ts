import { useCallback, useSyncExternalStore } from "react";
import {
  readRepositoryHistoryOrder,
  subscribeRepositoryHistoryOrder,
} from "#web/features/repository-settings/preferences/repository-history-order";

export function useRepositoryHistoryOrder(
  environmentId: string | undefined,
  repositoryId: string | undefined,
) {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (environmentId === undefined || repositoryId === undefined)
        return () => {};
      return subscribeRepositoryHistoryOrder(
        { environmentId, repositoryId },
        notify,
      );
    },
    [environmentId, repositoryId],
  );
  const getSnapshot = useCallback(
    () =>
      environmentId === undefined || repositoryId === undefined
        ? ("topological" as const)
        : readRepositoryHistoryOrder({ environmentId, repositoryId }),
    [environmentId, repositoryId],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
