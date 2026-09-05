import { expect, it, vi } from "vitest";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import {
  type RepositoryHistoryGateway,
  RepositoryHistoryOffline,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";

it("settles a connection awaiting cache clear after an unhandled worker rejection", async () => {
  const name = crypto.randomUUID();
  const control = new BroadcastChannel(`history-clear-${name}`);
  const waiting = Promise.withResolvers<void>();
  const connecting = Promise.withResolvers<void>();
  control.onmessage = (message) => {
    if (message.data === "waiting") waiting.resolve();
    if (message.data === "connecting") connecting.resolve();
  };
  const workerUrl = new URL(
    "./fixtures/history-cache-clear-worker.ts",
    import.meta.url,
  );
  const workers = [
    new SharedWorker(workerUrl, { type: "module", name }),
    new SharedWorker(workerUrl, { type: "module", name }),
  ] as const;
  const errors = vi.fn();
  for (const worker of workers) worker.addEventListener("error", errors);
  const gateway: RepositoryHistoryGateway = {
    read: async () => {
      throw new RepositoryHistoryOffline();
    },
    synchronize: async () => {
      throw new RepositoryHistoryOffline();
    },
  };
  const first = createBrowserRepositoryHistoryReader({
    environmentId: crypto.randomUUID(),
    repositoryId: crypto.randomUUID(),
    gateway,
    worker: workers[0],
  });
  let second:
    | ReturnType<typeof createBrowserRepositoryHistoryReader>
    | undefined;
  try {
    await first.getRefTargets();
    const clearing = Promise.allSettled([first.manageCache("clear-all")]);
    await waiting.promise;
    second = createBrowserRepositoryHistoryReader({
      environmentId: crypto.randomUUID(),
      repositoryId: crypto.randomUUID(),
      gateway,
      worker: workers[1],
    });
    const pending = Promise.allSettled([second.getRefTargets()]);
    await connecting.promise;
    control.postMessage("crash");
    await expect.poll(() => first.getSnapshot().status).toBe("error");
    await expect.poll(() => second?.getSnapshot().status).toBe("error");
    for (const result of [...(await clearing), ...(await pending)]) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason).toBeInstanceOf(RepositoryHistoryUnavailable);
    }
    expect(errors).not.toHaveBeenCalled();
  } finally {
    first.close();
    second?.close();
    control.close();
    for (const worker of workers) worker.port.close();
  }
});

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
