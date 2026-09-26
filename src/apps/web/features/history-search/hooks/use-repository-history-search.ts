import type { RepositoryHistorySearchModel } from "#web/features/history-search/repository-history-search";
import { emptyHistorySearchSnapshot } from "#web/features/history-search/repository-history-search-model";
import { createStore } from "#web/platform/store/store";
import { useStore } from "#web/platform/store/use-store";

const emptySearch = createStore(emptyHistorySearchSnapshot);
const ignore = () => {};

export function useRepositoryHistorySearch(
  model: RepositoryHistorySearchModel | undefined,
) {
  const state = useStore(model ?? emptySearch);
  return {
    ...state,
    setText: model?.setText ?? ignore,
    retry: model?.retry ?? ignore,
    loadMore: model?.loadMore ?? ignore,
    navigate: model?.navigate ?? ignore,
    next: model?.next ?? ignore,
    previous: model?.previous ?? ignore,
    error:
      state.error === undefined
        ? undefined
        : state.error.operation === "search"
          ? "Could not search cached history."
          : "Could not open this search result.",
  };
}
