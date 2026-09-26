import { dehydrate } from "@tanstack/react-query";
import type { Persister } from "@tanstack/react-query-persist-client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createEnvironmentQueryClient } from "#web/platform/query/environment-query-client";
import { persistOnlyChanges } from "#web/platform/query/persist-only-changes";

afterEach(() => {
  vi.useRealTimers();
});

describe("persisting environment queries", () => {
  it("writes the client only when persisted data changes", async () => {
    const persistClient = vi.fn<Persister["persistClient"]>();
    const persister = persistOnlyChanges({
      persistClient,
      restoreClient: async () => undefined,
      removeClient: async () => undefined,
    });
    const queryClient = createEnvironmentQueryClient();
    const read = (branches: readonly string[]) =>
      queryClient.fetchQuery({
        queryKey: ["repository-refs"],
        queryFn: async () => ({ branches }),
        staleTime: 0,
      });
    const persist = () =>
      persister.persistClient({
        buster: "",
        clientState: dehydrate(queryClient),
        timestamp: Date.now(),
      });

    vi.useFakeTimers({ now: 1, toFake: ["Date"] });
    await read(["main"]);
    await persist();
    vi.setSystemTime(2);
    await read(["main"]);
    await persist();
    expect(persistClient).toHaveBeenCalledOnce();

    await read(["main", "feature"]);
    await persist();
    expect(persistClient).toHaveBeenCalledTimes(2);
  });
});
