import {
  QueryCache,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

const answeredQueries = new WeakSet<object>();

export function createLiveQueryCache() {
  return new QueryCache({
    onSuccess: (_data, query) => {
      answeredQueries.add(query);
    },
  });
}

export function hasLiveData(queryClient: QueryClient, queryKey: QueryKey) {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  return query !== undefined && answeredQueries.has(query);
}
