import {
  encodeRepositoryHistoryBatch,
  fragmentBinaryMessage,
} from "@rebase/contracts";
import { Effect, Fiber } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { createRepositoryHistoryTransport } from "#web/features/repository-history/transport/repository-history-transport";

describe("repository history transport", () => {
  it.each([
    [
      "complete",
      {
        _tag: "Complete",
        commitCount: 12,
        objectFormat: "sha1",
        rootOids: ["a".repeat(40)],
        snapshotId: "b".repeat(64),
      },
    ],
    [
      "incomplete",
      {
        _tag: "Incomplete",
        committedCommitCount: 8,
        nextBatchSequence: 7,
        objectFormat: "sha1",
        rootOids: ["c".repeat(40)],
        snapshotId: "d".repeat(64),
      },
    ],
  ] as const)("forwards a %s synchronization basis", async (_name, basis) => {
    const send = vi.fn();
    const transport = createRepositoryHistoryTransport({ send }, true);
    const synchronization = Effect.runFork(
      transport.synchronize(
        {
          basis,
          priority: "visible",
          repositoryId: "00000000-0000-4000-8000-000000000001",
        },
        () => Effect.void,
      ),
    );

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(JSON.parse(String(send.mock.calls[0]?.[0]))).toMatchObject({
      basis,
    });
    await Effect.runPromise(Fiber.interrupt(synchronization));
  });

  it("acknowledges a synchronization batch only after it is committed", async () => {
    const send = vi.fn();
    const transport = createRepositoryHistoryTransport({ send }, true);
    let commitBatch: (() => void) | undefined;
    const committed = new Promise<void>((resolve) => {
      commitBatch = resolve;
    });
    const synchronization = Effect.runFork(
      transport.synchronize(
        {
          priority: "visible",
          repositoryId: "00000000-0000-4000-8000-000000000001",
        },
        () => Effect.promise(() => committed),
      ),
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const request = JSON.parse(String(send.mock.calls[0]?.[0])) as {
      readonly requestId: string;
    };
    const payload = encodeRepositoryHistoryBatch({
      commits: [],
      objectFormat: "sha1",
      repositoryId: "00000000-0000-4000-8000-000000000001",
      requestId: request.requestId,
      sequence: 0,
    });
    const [frame] = fragmentBinaryMessage(
      { logicalMessageId: 1, payload, requestId: request.requestId },
      16_384,
    );
    const accepting = Effect.runFork(
      transport.acceptBinary(frame ?? new Uint8Array()),
    );

    await Promise.resolve();
    expect(send).toHaveBeenCalledOnce();
    commitBatch?.();
    await Effect.runPromise(Fiber.join(accepting));
    expect(JSON.parse(String(send.mock.calls[1]?.[0]))).toMatchObject({
      _tag: "AcknowledgeRepositoryHistoryBatch",
      requestId: request.requestId,
      sequence: 0,
    });

    await Effect.runPromise(
      transport.acceptSynchronized({
        _tag: "RepositoryHistorySynchronized",
        commitCount: 0,
        requestId: request.requestId,
      }),
    );
    await expect(Effect.runPromise(Fiber.join(synchronization))).resolves.toBe(
      0,
    );
  });

  it("runs one synchronization at a time and prioritizes visible repositories", async () => {
    const send = vi.fn();
    const transport = createRepositoryHistoryTransport({ send }, true);
    const start = (repositoryId: string, priority: "background" | "visible") =>
      Effect.runFork(
        transport.synchronize({ priority, repositoryId }, () => Effect.void),
      );
    const first = start("00000000-0000-4000-8000-000000000001", "background");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const background = start(
      "00000000-0000-4000-8000-000000000002",
      "background",
    );
    const visible = start("00000000-0000-4000-8000-000000000003", "visible");
    await Promise.resolve();
    const active = JSON.parse(String(send.mock.calls[0]?.[0])) as {
      readonly requestId: string;
    };

    await Effect.runPromise(
      transport.acceptSynchronized({
        _tag: "RepositoryHistorySynchronized",
        commitCount: 0,
        requestId: active.requestId,
      }),
    );

    expect(JSON.parse(String(send.mock.calls[1]?.[0]))).toMatchObject({
      _tag: "SynchronizeRepositoryHistory",
      repositoryId: "00000000-0000-4000-8000-000000000003",
    });
    await Effect.runPromise(Fiber.interrupt(background));
    await Effect.runPromise(Fiber.interrupt(visible));
    await Effect.runPromise(Fiber.interrupt(first));
  });

  it("releases the synchronization slot when starting a request fails", async () => {
    const send = vi.fn();
    send
      .mockImplementationOnce(() => {
        throw new Error("Socket closed");
      })
      .mockImplementation(() => undefined);
    const transport = createRepositoryHistoryTransport({ send }, true);

    await expect(
      Effect.runPromise(
        transport.synchronize(
          {
            priority: "background",
            repositoryId: "00000000-0000-4000-8000-000000000001",
          },
          () => Effect.void,
        ),
      ),
    ).rejects.toBeDefined();
    const next = Effect.runFork(
      transport.synchronize(
        {
          priority: "visible",
          repositoryId: "00000000-0000-4000-8000-000000000002",
        },
        () => Effect.void,
      ),
    );

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(send.mock.calls[1]?.[0]))).toMatchObject({
      _tag: "SynchronizeRepositoryHistory",
      repositoryId: "00000000-0000-4000-8000-000000000002",
    });
    await Effect.runPromise(Fiber.interrupt(next));
  });

  it("releases the synchronization slot when an acknowledgement cannot be sent", async () => {
    const send = vi.fn();
    send.mockImplementation(() => undefined);
    const transport = createRepositoryHistoryTransport({ send }, true);
    const first = Effect.runFork(
      transport.synchronize(
        {
          priority: "visible",
          repositoryId: "00000000-0000-4000-8000-000000000001",
        },
        () => Effect.void,
      ),
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const request = JSON.parse(String(send.mock.calls[0]?.[0])) as {
      readonly requestId: string;
    };
    send.mockImplementationOnce(() => {
      throw new Error("Socket closed");
    });
    const payload = encodeRepositoryHistoryBatch({
      commits: [],
      objectFormat: "sha1",
      repositoryId: "00000000-0000-4000-8000-000000000001",
      requestId: request.requestId,
      sequence: 0,
    });
    const [frame] = fragmentBinaryMessage(
      { logicalMessageId: 1, payload, requestId: request.requestId },
      16_384,
    );

    await expect(
      Effect.runPromise(transport.acceptBinary(frame ?? new Uint8Array())),
    ).rejects.toBeDefined();
    await expect(Effect.runPromise(Fiber.join(first))).rejects.toBeDefined();
    const next = Effect.runFork(
      transport.synchronize(
        {
          priority: "visible",
          repositoryId: "00000000-0000-4000-8000-000000000002",
        },
        () => Effect.void,
      ),
    );

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(send.mock.calls[2]?.[0]))).toMatchObject({
      _tag: "SynchronizeRepositoryHistory",
      repositoryId: "00000000-0000-4000-8000-000000000002",
    });
    await Effect.runPromise(Fiber.interrupt(next));
  });

  it("advances past a promoted synchronization that cannot be sent", async () => {
    const failedRepositoryId = "00000000-0000-4000-8000-000000000002";
    const nextRepositoryId = "00000000-0000-4000-8000-000000000003";
    const send = vi.fn((value: string) => {
      const message = JSON.parse(value) as {
        readonly _tag: string;
        readonly repositoryId?: string;
      };
      if (
        message._tag === "SynchronizeRepositoryHistory" &&
        message.repositoryId === failedRepositoryId
      ) {
        throw new Error("Socket send failed");
      }
    });
    const transport = createRepositoryHistoryTransport({ send }, true);
    const start = (repositoryId: string) =>
      Effect.runFork(
        transport.synchronize(
          { priority: "background", repositoryId },
          () => Effect.void,
        ),
      );
    const active = start("00000000-0000-4000-8000-000000000001");
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const failed = start(failedRepositoryId);
    const next = start(nextRepositoryId);

    await Effect.runPromise(Fiber.interrupt(active));

    await expect(Effect.runPromise(Fiber.join(failed))).rejects.toBeDefined();
    await vi.waitFor(() =>
      expect(
        send.mock.calls.some(([value]) => {
          const message = JSON.parse(value) as {
            readonly repositoryId?: string;
          };
          return message.repositoryId === nextRepositoryId;
        }),
      ).toBe(true),
    );
    await Effect.runPromise(Fiber.interrupt(next));
  });

  it("ignores terminal responses and fragments that arrive after cancellation", async () => {
    const send = vi.fn();
    const transport = createRepositoryHistoryTransport({ send }, true);
    const read = Effect.runFork(
      transport.read({
        limit: 100,
        order: "topological",
        repositoryId: "00000000-0000-4000-8000-000000000001",
        roots: [{ name: "main", oid: "a".repeat(40), type: "branch" as const }],
      }),
    );
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const request = JSON.parse(String(send.mock.calls[0]?.[0])) as {
      readonly requestId: string;
    };
    const frames = fragmentBinaryMessage(
      {
        logicalMessageId: 1,
        payload: new Uint8Array(100),
        requestId: request.requestId,
      },
      96,
    );
    const first = frames[0];
    expect(first).toBeDefined();
    await Effect.runPromise(transport.acceptBinary(first ?? new Uint8Array()));

    await Effect.runPromise(Fiber.interrupt(read));

    await expect(
      Effect.runPromise(transport.acceptBinary(first ?? new Uint8Array())),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(transport.acceptBinary(first ?? new Uint8Array())),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(
        transport.acceptFailure({
          _tag: "RepositoryHistoryFailed",
          failure: { _tag: "GitFailed", reason: "Failed" },
          requestId: request.requestId,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
