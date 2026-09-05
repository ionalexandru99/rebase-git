import { expect, it, vi } from "vitest";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import {
  RepositoryHistoryOffline,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";

it.each(["startup", "runtime"] as const)(
  "settles readers and releases their leases after worker %s failure",
  async (failure) => {
    const leasesBefore = new Set(
      (await navigator.locks.query()).held?.map(({ name }) => name),
    );
    const worker = new SharedWorker(
      new URL(
        failure === "startup"
          ? "./fixtures/history-startup-failure-worker.ts"
          : "./fixtures/history-runtime-failure-worker.ts",
        import.meta.url,
      ),
      { type: "module", name: crypto.randomUUID() },
    );
    worker.addEventListener("error", (event) => event.preventDefault());
    const unsubscribe = vi.fn();
    const connection = {
      environmentId: crypto.randomUUID(),
      repositoryId: crypto.randomUUID(),
      gateway: {
        read: async () => {
          throw new RepositoryHistoryOffline();
        },
        synchronize: async () => {
          throw new RepositoryHistoryOffline();
        },
        subscribeAvailability: () => unsubscribe,
      },
    };
    const readers = [0, 1].map(() =>
      createBrowserRepositoryHistoryReader({ ...connection, worker }),
    );
    const notifications = readers.map((reader) => {
      const notify = vi.fn();
      reader.subscribe(() => {
        if (reader.getSnapshot().status === "error") notify();
      });
      return notify;
    });
    try {
      const results = await Promise.allSettled(
        readers.flatMap((reader) => [
          reader.getRefTargets(),
          reader.getCommitSummaries([]),
        ]),
      );
      for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected")
          expect(result.reason).toBeInstanceOf(RepositoryHistoryUnavailable);
      }
      for (const reader of readers) {
        expect(reader.getSnapshot()).toMatchObject({ status: "error" });
        expect(reader.getSnapshot().error).toBeInstanceOf(
          RepositoryHistoryUnavailable,
        );
        await expect(reader.getRefTargets()).rejects.toBeInstanceOf(
          RepositoryHistoryUnavailable,
        );
      }
      worker.dispatchEvent(new Event("error"));
      for (const notify of notifications) expect(notify).toHaveBeenCalledOnce();
      expect(unsubscribe).toHaveBeenCalledTimes(2);
      await expect
        .poll(async () => {
          const leases = await navigator.locks.query();
          return [...(leases.held ?? []), ...(leases.pending ?? [])].filter(
            ({ name }) =>
              name?.startsWith("rebase-history-reader:") &&
              !leasesBefore.has(name),
          );
        })
        .toEqual([]);
    } finally {
      for (const reader of readers) {
        reader.close();
        reader.close();
      }
      worker.port.close();
    }
    const reopened = createBrowserRepositoryHistoryReader(connection);
    try {
      await expect(reopened.getRefTargets()).resolves.toEqual([]);
      expect(reopened.getSnapshot().status).not.toBe("error");
    } finally {
      reopened.close();
    }
  },
);
