import { describe, expect, it } from "vite-plus/test";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import { RepositoryHistoryUnavailable } from "#web/features/repository-history/repository-history-reader.contract";

describe("history worker replies", () => {
  it("rejects a reply for another operation and keeps correctly matched requests usable", async () => {
    const worker = new SharedWorker(
      new URL("./fixtures/history-reply-worker.ts", import.meta.url),
      { type: "module", name: crypto.randomUUID() },
    );
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: crypto.randomUUID(),
      repositoryId: crypto.randomUUID(),
      gateway: {
        read: async () => {
          throw new RepositoryHistoryUnavailable();
        },
        synchronize: async () => {
          throw new RepositoryHistoryUnavailable();
        },
      },
      worker,
    });
    try {
      await expect(reader.getRefTargets()).rejects.toBeInstanceOf(
        RepositoryHistoryUnavailable,
      );
      await expect(
        reader.locate({ roots: [], order: "topological", limit: 10 }, "commit"),
      ).resolves.toBe(7);
    } finally {
      reader.close();
      worker.port.close();
    }
  });
});
