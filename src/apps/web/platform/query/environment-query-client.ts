import { QueryClient } from "@tanstack/react-query";

export function createEnvironmentQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
        refetchOnReconnect: false,
      },
    },
  });
}
