import {
  createCurrentEnvironmentDiscovery,
  createCurrentEnvironmentHello,
  negotiateEnvironmentHello,
} from "@rebase/contracts";
import {
  EnvironmentHelloRejected,
  type EnvironmentProtocolConnection,
  EnvironmentResponseError,
} from "@rebase/web/features/environment-connection";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { createLocalEnvironmentSession } from "#web/features/local-environment-session/local-environment-session";
import type {
  LocalEnvironmentGateway,
  LocalEnvironmentSessionState,
} from "#web/features/local-environment-session/local-environment-session.contract";

describe("local Environment session", () => {
  it("exchanges the pairing material and opens the initial connection", async () => {
    const connection = createConnection();
    const gateway = createGateway(connection);
    const pairingSucceeded = vi.fn();
    const session = createLocalEnvironmentSession({
      gateway,
      pairingMaterial: "123-456",
      pairingSucceeded,
    });

    session.start();
    await expectState(session.getSnapshot, "Connected");

    expect(gateway.exchangePairing).toHaveBeenCalledOnce();
    expect(gateway.connect).toHaveBeenCalledWith(
      "device-credential",
      undefined,
    );
    expect(pairingSucceeded).toHaveBeenCalledOnce();
    session.stop();
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce());
  });

  it("owns one reconnect after the active connection closes", async () => {
    const initial = createConnection(7);
    const reconnected = createConnection(8);
    const gateway = createGateway(initial, reconnected);
    const reconnect = deferred<void>();
    const waitBeforeReconnect = vi.fn(() =>
      Effect.promise(() => reconnect.promise),
    );
    const session = createLocalEnvironmentSession({
      gateway,
      pairingMaterial: "123-456",
      waitBeforeReconnect,
    });

    session.start();
    await expectState(session.getSnapshot, "Connected");
    initial.disconnect.resolve(
      new EnvironmentResponseError({ responseTag: "WebSocket" }),
    );
    await expectState(session.getSnapshot, "Reconnecting");
    expect(gateway.connect).toHaveBeenCalledTimes(1);

    reconnect.resolve();
    await expectState(session.getSnapshot, "Connected");
    expect(gateway.connect).toHaveBeenNthCalledWith(2, "device-credential", 7);
    expect(waitBeforeReconnect).toHaveBeenCalledOnce();
    session.stop();
  });

  it("stops on a protocol mismatch without starting a retry loop", async () => {
    const gateway = createGateway();
    gateway.connect.mockReturnValue(
      Effect.fail(
        new EnvironmentHelloRejected({
          failure: {
            _tag: "ProtocolMajorMismatch",
            clientMajor: 1,
            requiredUpdate: "client",
            serverMajor: 2,
          },
        }),
      ),
    );
    const waitBeforeReconnect = vi.fn(() => Effect.void);
    const session = createLocalEnvironmentSession({
      gateway,
      pairingMaterial: "123-456",
      waitBeforeReconnect,
    });

    session.start();
    await expectState(session.getSnapshot, "ProtocolMismatch");

    expect(gateway.connect).toHaveBeenCalledOnce();
    expect(waitBeforeReconnect).not.toHaveBeenCalled();
    session.stop();
  });
});

function createGateway(...connections: ReturnType<typeof createConnection>[]) {
  const remaining = [...connections];
  return {
    connect: vi.fn<LocalEnvironmentGateway["connect"]>(() => {
      const connection = remaining.shift();
      if (connection === undefined) {
        return Effect.die("No test connection is available.");
      }
      return Effect.acquireRelease(Effect.succeed(connection), (active) =>
        Effect.sync(active.close),
      );
    }),
    exchangePairing: vi.fn<LocalEnvironmentGateway["exchangePairing"]>(() =>
      Effect.succeed({ credential: "device-credential" }),
    ),
  } satisfies LocalEnvironmentGateway & {
    connect: ReturnType<typeof vi.fn<LocalEnvironmentGateway["connect"]>>;
    exchangePairing: ReturnType<
      typeof vi.fn<LocalEnvironmentGateway["exchangePairing"]>
    >;
  };
}

function createConnection(currentSequence = 0) {
  const disconnect = deferred<EnvironmentResponseError>();
  const discovery = createCurrentEnvironmentDiscovery(
    "00000000-0000-4000-8000-000000000001",
    "0.0.0",
  );
  const negotiated = negotiateEnvironmentHello(
    discovery,
    createCurrentEnvironmentHello("0.0.0"),
    currentSequence,
  );
  if (negotiated._tag === "HelloRejected") {
    throw new Error("The test protocol should be compatible.");
  }
  return {
    close: vi.fn(),
    closed: Effect.promise(() => disconnect.promise),
    currentSequence: () => currentSequence,
    disconnect,
    discovery,
    negotiated,
    waitForSequence: vi.fn((sequence: number) => Effect.succeed(sequence)),
  } satisfies EnvironmentProtocolConnection & {
    readonly disconnect: ReturnType<typeof deferred<EnvironmentResponseError>>;
  };
}

async function expectState(
  getSnapshot: () => LocalEnvironmentSessionState,
  tag: LocalEnvironmentSessionState["_tag"],
) {
  await vi.waitFor(() => expect(getSnapshot()._tag).toBe(tag));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolved) => {
    resolve = resolved;
  });
  return { promise, resolve };
}
