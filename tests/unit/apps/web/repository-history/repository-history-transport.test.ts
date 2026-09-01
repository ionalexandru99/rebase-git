import { fragmentBinaryMessage } from "@rebase/contracts";
import { Effect, Fiber } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { createRepositoryHistoryTransport } from "#web/features/repository-history/repository-history-transport";

describe("repository history transport", () => {
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
