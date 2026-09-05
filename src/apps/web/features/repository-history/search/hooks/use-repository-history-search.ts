import { useSyncExternalStore } from "react";
import { emptyHistorySearchSnapshot } from "#web/features/repository-history/search/repository-history-search-model";
import type { RepositoryHistorySearchModel } from "#web/features/repository-history/search/repository-history-search-model.contract";

const subscribeEmpty = () => () => {};
const readEmpty = () => emptyHistorySearchSnapshot;
const ignore = () => {};

export function useRepositoryHistorySearch(
  model: RepositoryHistorySearchModel | undefined,
) {
  const state = useSyncExternalStore(
    model?.subscribe ?? subscribeEmpty,
    model?.getSnapshot ?? readEmpty,
    readEmpty,
  );
  return {
    ...state,
    setText: model?.setText ?? ignore,
    retry: model?.retry ?? ignore,
    navigate: model?.navigate ?? ignore,
    next: model?.next ?? ignore,
    previous: model?.previous ?? ignore,
    error:
      state.error === undefined
        ? undefined
        : state.error.operation === "search"
          ? "Could not search cached history."
          : "Could not open this search result.",
    canNext:
      !state.loading &&
      !state.navigating &&
      (state.selected + 1 < state.commits.length || state.cursor !== undefined),
    canPrevious:
      !state.loading &&
      !state.navigating &&
      (state.selected > 0 || (state.selected < 0 && state.commits.length > 0)),
  };
}
