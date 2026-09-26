import { QueryClient } from "@tanstack/react-query";

export function createEnvironmentQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
        refetchOnReconnect: false,
      },
      mutations: {
        networkMode: "always",
      },
    },
  });
}
