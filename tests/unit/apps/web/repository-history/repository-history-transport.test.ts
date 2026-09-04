import {
  encodeRepositoryHistoryBatch,
  fragmentBinaryMessage,
} from "@rebase/contracts";
import { Effect, Fiber } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { createRepositoryHistoryTransport } from "#web/features/repository-history/repository-history-transport";

describe("repository history transport", () => {
  it("acknowledges a synchronization batch only after it is committed", async () => {
    const send = vi.fn();
    const transport = createRepositoryHistoryTransport(
      { send } as unknown as WebSocket,
      true,
    );
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
    const transport = createRepositoryHistoryTransport(
      { send } as unknown as WebSocket,
      true,
    );
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

  it("ignores terminal responses and fragments that arrive after cancellation", async () => {
    const send = vi.fn();
    const transport = createRepositoryHistoryTransport(
      { send } as unknown as WebSocket,
      true,
    );
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
