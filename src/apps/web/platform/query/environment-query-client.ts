import { focusManager, QueryClient } from "@tanstack/react-query";
import { createLiveQueryCache } from "#web/platform/query/live-query-data";

export function createEnvironmentQueryClient() {
  focusManager.setEventListener(listenForWindowFocus);
  return new QueryClient({
    queryCache: createLiveQueryCache(),
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

function listenForWindowFocus(onFocus: () => void) {
  if (typeof window === "undefined") return undefined;
  const listener = () => onFocus();
  window.addEventListener("visibilitychange", listener);
  window.addEventListener("focus", listener);
  return () => {
    window.removeEventListener("visibilitychange", listener);
    window.removeEventListener("focus", listener);
  };
}
