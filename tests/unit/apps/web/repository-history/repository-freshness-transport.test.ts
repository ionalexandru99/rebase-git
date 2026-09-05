import type { RepositoryFreshness } from "@rebase/contracts";
import { Effect, Fiber } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { environmentResponseError } from "#web/features/environment-connection/environment-connection-errors";
import { createRepositoryFreshnessTransport } from "#web/features/repository-history/repository-freshness-transport";
import { createRepositoryHistoryGateway } from "#web/features/repository-history/repository-history-gateway";
import type { RepositoryHistoryTransport } from "#web/features/repository-history/repository-history-reader.contract";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const state: RepositoryFreshness = {
  defaultIntervalSeconds: 300,
  fetching: false,
  stale: false,
  revision: 0,
  setting: { _tag: "Inherit" },
};

describe("repository freshness transport", () => {
  it("keeps observing after a failed fetch and unsubscribes on cancellation", async () => {
    const send = vi.fn();
    const transport = createRepositoryFreshnessTransport(
      { send } as unknown as WebSocket,
      true,
    );
    const publish = vi.fn();
    const observing = Effect.runFork(transport.observe(repositoryId, publish));
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const subscriptionId = JSON.parse(
      String(send.mock.calls[0]?.[0]),
    ).requestId;
    await Effect.runPromise(
      transport.accept({
        _tag: "RepositoryHistoryFreshness",
        repositoryId,
        requestId: subscriptionId,
        freshness: state,
      }),
    );
    const fetch = Effect.runPromise(transport.fetch(repositoryId));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const requestId = JSON.parse(String(send.mock.calls[1]?.[0])).requestId;
    const failed: RepositoryFreshness = {
      ...state,
      stale: true,
      failure: { _tag: "FetchFailed", reason: "Failed" },
    };
    await Effect.runPromise(
      transport.accept({
        _tag: "RepositoryHistoryFreshness",
        repositoryId,
        requestId,
        freshness: failed,
      }),
    );
    expect(await fetch).toEqual(failed);
    await Effect.runPromise(
      transport.accept({
        _tag: "RepositoryHistoryFreshness",
        repositoryId,
        requestId: subscriptionId,
        freshness: { ...state, revision: 1 },
      }),
    );
    expect(publish).toHaveBeenCalledTimes(2);
    await Effect.runPromise(Fiber.interrupt(observing));
    expect(JSON.parse(String(send.mock.calls.at(-1)?.[0]))).toEqual({
      _tag: "UnsubscribeRepositoryHistory",
      repositoryId,
    });
  });

  it("matches commands to their repository and rejects pending work when disconnected", async () => {
    const send = vi.fn();
    const transport = createRepositoryFreshnessTransport(
      { send } as unknown as WebSocket,
      true,
    );
    const configured = Effect.runPromise(
      transport.configure(repositoryId, { _tag: "Disabled" }),
    );
    const rejected = expect(configured).rejects.toMatchObject({
      _tag: "EnvironmentResponseError",
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const requestId = JSON.parse(String(send.mock.calls[0]?.[0])).requestId;
    await Effect.runPromise(
      transport.accept({
        _tag: "RepositoryHistoryFreshness",
        repositoryId: "00000000-0000-4000-8000-000000000009",
        requestId,
        freshness: state,
      }),
    );
    await Effect.runPromise(
      transport.close(environmentResponseError("WebSocket")),
    );
    await rejected;
  });

  it("reconnects existing gateway subscriptions without reviving released readers", async () => {
    const gateway = createRepositoryHistoryGateway();
    const firstSend = vi.fn();
    const secondSend = vi.fn();
    const first = historyTransport(firstSend);
    const second = historyTransport(secondSend);
    const publish = vi.fn();
    const fail = vi.fn();
    gateway.connect(first);
    const release = gateway.gateway.freshness?.subscribe(
      repositoryId,
      publish,
      fail,
    );
    await vi.waitFor(() => expect(firstSend).toHaveBeenCalledOnce());
    gateway.disconnect(first);
    expect(fail).toHaveBeenCalledOnce();
    gateway.connect(second);
    await vi.waitFor(() => expect(secondSend).toHaveBeenCalledOnce());
    const requestId = JSON.parse(
      String(secondSend.mock.calls[0]?.[0]),
    ).requestId;
    await Effect.runPromise(
      second.freshness.accept({
        _tag: "RepositoryHistoryFreshness",
        repositoryId,
        requestId,
        freshness: state,
      }),
    );
    expect(publish).toHaveBeenCalledWith(state);
    release?.();
    gateway.disconnect(second);
    gateway.connect(historyTransport(vi.fn()));
    expect(fail).toHaveBeenCalledOnce();
  });
});

function historyTransport(send: ReturnType<typeof vi.fn>) {
  return {
    freshness: createRepositoryFreshnessTransport(
      { send } as unknown as WebSocket,
      true,
    ),
    read: () => Effect.die("unused"),
    synchronize: () => Effect.die("unused"),
  } satisfies RepositoryHistoryTransport;
}
