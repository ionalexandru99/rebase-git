import type { EnvironmentRpcClient } from "@rebase/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentAccessDenied,
  EnvironmentProtocolMismatch,
  EnvironmentUnavailable,
} from "#web/app/environment/environment-connection";
import {
  createLocalEnvironmentSession,
  type EnvironmentConnected,
  type LocalEnvironmentGateway,
  type LocalEnvironmentSessionOptions,
  type LocalEnvironmentSessionState,
} from "#web/app/environment/local-environment-session";

const runtime = ManagedRuntime.make(Layer.empty);
const environmentId = "00000000-0000-4000-8000-000000000001";

describe("local Environment session", () => {
  it("authorizes, runs the connect hook and releases it on stop", async () => {
    const connection = createConnection();
    const gateway = createGateway(connection);
    const feature = createFeature();
    const session = createSession({ onConnect: feature.connect, gateway });

    session.start();
    await expectState(session.getSnapshot, "Connected");
    expect(gateway.authorize).toHaveBeenCalledOnce();
    expect(gateway.connect).toHaveBeenCalledWith({
      type: "bearer",
      value: "device-credential",
    });
    expect(feature.connect).toHaveBeenCalledExactlyOnceWith(connection.rpc);
    session.stop();

    await expect.poll(() => feature.released).toHaveBeenCalledOnce();
    await expect.poll(() => connection.close).toHaveBeenCalledOnce();
  });

  it.each(["InvalidGrant", "RevokedGrant"] as const)(
    "stops when authorization fails with %s",
    async (failure) => {
      const gateway = createGateway();
      gateway.authorize.mockReturnValue(
        Effect.fail(
          new EnvironmentAccessDenied({ failure: { _tag: failure } }),
        ),
      );
      const session = createSession({ gateway });

      session.start();
      await expectState(
        session.getSnapshot,
        failure === "InvalidGrant" ? "PairingRequired" : "AuthorizationFailed",
      );
      expect(gateway.connect).not.toHaveBeenCalled();
      session.stop();
    },
  );

  it("asks a browser to pair again when the socket refuses its session", async () => {
    const gateway = createGateway();
    gateway.authorize.mockReturnValue(
      Effect.succeed({ type: "browser-session" }),
    );
    gateway.connect.mockReturnValue(
      Effect.fail(
        new EnvironmentAccessDenied({ failure: { _tag: "InvalidGrant" } }),
      ),
    );
    const session = createSession({ gateway });

    session.start();
    await expectState(session.getSnapshot, "PairingRequired");
    session.stop();
  });

  it("reconnects after the connection closes and refreshes every query each time", async () => {
    const initial = createConnection();
    const reconnected = createConnection();
    const gateway = createGateway(initial, reconnected);
    const invalidation = { changed: vi.fn() };
    const reconnect = Promise.withResolvers<void>();
    const waitBeforeReconnect = vi.fn(() =>
      Effect.promise(() => reconnect.promise),
    );
    const session = createSession({
      gateway,
      invalidation,
      waitBeforeReconnect,
    });

    session.start();
    await expectState(session.getSnapshot, "Connected");
    expect(invalidation.changed).toHaveBeenCalledOnce();
    initial.disconnect.resolve(new EnvironmentUnavailable());
    await expectState(session.getSnapshot, "Reconnecting");
    expect(session.getSnapshot()).toMatchObject({ environmentId });

    reconnect.resolve();
    await expectState(session.getSnapshot, "Connected");
    expect(gateway.connect).toHaveBeenCalledTimes(2);
    expect(invalidation.changed).toHaveBeenCalledTimes(2);
    expect(invalidation.changed).toHaveBeenLastCalledWith();
    session.stop();
  });

  it("stops on a protocol mismatch without starting a retry loop", async () => {
    const gateway = createGateway();
    gateway.connect.mockReturnValue(
      Effect.fail(new EnvironmentProtocolMismatch({ serverProtocol: 1 })),
    );
    const waitBeforeReconnect = vi.fn(() => Effect.void);
    const session = createSession({ gateway, waitBeforeReconnect });

    session.start();
    await expectState(session.getSnapshot, "ProtocolMismatch");
    expect(session.getSnapshot()).toMatchObject({
      message: expect.stringContaining("server is older"),
    });
    expect(waitBeforeReconnect).not.toHaveBeenCalled();
    session.stop();
  });
});

function createSession(
  options: Partial<LocalEnvironmentSessionOptions> &
    Pick<LocalEnvironmentSessionOptions, "gateway">,
) {
  return createLocalEnvironmentSession({
    invalidation: { changed: () => {} },
    runtime,
    ...options,
  });
}

function createFeature() {
  const released = vi.fn();
  const connect = vi.fn<EnvironmentConnected>(() =>
    Effect.acquireRelease(Effect.void, () => Effect.sync(released)),
  );
  return { connect, released };
}

function createGateway(...connections: ReturnType<typeof createConnection>[]) {
  const remaining = [...connections];
  return {
    connect: vi.fn<LocalEnvironmentGateway["connect"]>(() => {
      const connection = remaining.shift();
      if (connection === undefined)
        return Effect.die("No test connection is available.");
      return Effect.acquireRelease(Effect.succeed(connection), (active) =>
        Effect.sync(active.close),
      );
    }),
    authorize: vi.fn<LocalEnvironmentGateway["authorize"]>(() =>
      Effect.succeed({ type: "bearer", value: "device-credential" }),
    ),
  };
}

function createConnection() {
  const disconnect = Promise.withResolvers<EnvironmentUnavailable>();
  return {
    close: vi.fn(),
    closed: Effect.promise(() => disconnect.promise),
    disconnect,
    environmentId,
    rpc: {} as EnvironmentRpcClient,
  };
}

async function expectState(
  getSnapshot: () => LocalEnvironmentSessionState,
  tag: LocalEnvironmentSessionState["_tag"],
) {
  await expect.poll(() => getSnapshot()._tag).toBe(tag);
}
