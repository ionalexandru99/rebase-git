import { expect, it, vi } from "vitest";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import {
  type RepositoryHistoryGateway,
  RepositoryHistoryOffline,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";

it.each(["startup", "runtime"] as const)(
  "settles readers and releases their leases after worker %s failure",
  async (failure) => {
    const leasesBefore = new Set(
      (await navigator.locks.query()).held?.map(({ name }) => name),
    );
    const workerUrl = new URL(
      failure === "startup"
        ? "./fixtures/history-startup-failure-worker.ts"
        : "./fixtures/history-runtime-failure-worker.ts",
      import.meta.url,
    );
    const workerOptions = {
      type: "module" as const,
      name: crypto.randomUUID(),
    };
    const worker = new SharedWorker(workerUrl, workerOptions);
    worker.addEventListener("error", (event) => event.preventDefault());
    const unsubscribe = vi.fn();
    const connection = {
      environmentId: crypto.randomUUID(),
      repositoryId: crypto.randomUUID(),
      gateway: {
        read: vi.fn(
          (
            _request: Parameters<RepositoryHistoryGateway["read"]>[0],
            signal?: AbortSignal,
          ) =>
            new Promise<Uint8Array>((_resolve, reject) => {
              signal?.addEventListener(
                "abort",
                () => reject(new RepositoryHistoryUnavailable()),
                { once: true },
              );
            }),
        ),
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
      if (failure === "runtime")
        await Promise.all(readers.map((reader) => reader.getRefTargets()));
      const settled = Promise.allSettled(
        readers.flatMap((reader) =>
          failure === "startup"
            ? [reader.getRefTargets(), reader.getCommitSummaries([])]
            : [
                reader.read({
                  limit: 1,
                  order: "topological",
                  roots: [
                    { name: "main", type: "branch", oid: "a".repeat(40) },
                  ],
                }),
              ],
        ),
      );
      if (failure === "runtime") {
        await expect
          .poll(() => connection.gateway.read.mock.calls.length)
          .toBe(2);
        worker.port.postMessage("fail");
      }
      const results = await settled;
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
    const recoveredWorker =
      failure === "runtime"
        ? new SharedWorker(workerUrl, workerOptions)
        : undefined;
    const reopened = createBrowserRepositoryHistoryReader({
      ...connection,
      ...(recoveredWorker === undefined ? {} : { worker: recoveredWorker }),
    });
    try {
      await expect(reopened.getRefTargets()).resolves.toEqual([]);
      expect(reopened.getSnapshot().status).not.toBe("error");
    } finally {
      reopened.close();
      recoveredWorker?.port.close();
    }
  },
);
