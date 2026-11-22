import { describe, expect, it, vi } from "vite-plus/test";
import {
  createLocalEnvironmentSession,
  type LocalEnvironmentGateway,
  type LocalEnvironmentSessionOptions,
  type LocalEnvironmentSessionState,
} from "#web/app/environment/local-environment-session.ts";
import type { EnvironmentConnection } from "#web/platform/environment/environment-connection.ts";

const environmentId = "00000000-0000-4000-8000-000000000001";

describe("local Environment session", () => {
  it("authorizes, reports the connection credential and closes it on stop", async () => {
    const connection = createConnection();
    const gateway = createGateway(connection);
    const onConnect = vi.fn();
    const session = createSession({ onConnect, gateway });

    session.start();
    await expectState(session.getSnapshot, "Connected");
    expect(gateway.authorize).toHaveBeenCalledOnce();
    expect(gateway.connect).toHaveBeenCalledWith({
      type: "bearer",
      value: "device-credential",
    });
    expect(onConnect).toHaveBeenCalledExactlyOnceWith({
      type: "bearer",
      value: "device-credential",
    });
    session.stop();

    await expect.poll(() => connection.close).toHaveBeenCalledOnce();
  });

  it.each(["InvalidGrant", "RevokedGrant"] as const)(
    "stops when authorization fails with %s",
    async (failure) => {
      const gateway = createGateway();
      gateway.authorize.mockRejectedValue({
        _tag: "EnvironmentAccessDenied",
        failure: { _tag: failure },
      });
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
    gateway.authorize.mockResolvedValue({ type: "browser-session" });
    gateway.connect.mockRejectedValue({
      _tag: "EnvironmentAccessDenied",
      failure: { _tag: "InvalidGrant" },
    });
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
    const waitBeforeReconnect = vi.fn(() => reconnect.promise);
    const session = createSession({
      gateway,
      invalidation,
      waitBeforeReconnect,
    });

    session.start();
    await expectState(session.getSnapshot, "Connected");
    expect(invalidation.changed).toHaveBeenCalledOnce();
    initial.disconnect.resolve();
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
    gateway.connect.mockRejectedValue({
      _tag: "EnvironmentProtocolMismatch",
      serverProtocol: 1,
    });
    const waitBeforeReconnect = vi.fn(async () => {});
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
    ...options,
  });
}

function createGateway(...connections: ReturnType<typeof createConnection>[]) {
  const remaining = [...connections];
  return {
    connect: vi.fn<LocalEnvironmentGateway["connect"]>(async () => {
      const connection = remaining.shift();
      if (connection === undefined)
        throw new Error("No test connection is available.");
      return connection;
    }),
    authorize: vi.fn<LocalEnvironmentGateway["authorize"]>(async () => ({
      type: "bearer",
      value: "device-credential",
    })),
  };
}

function createConnection() {
  const disconnect = Promise.withResolvers<void>();
  return {
    close: vi.fn(),
    closed: disconnect.promise,
    disconnect,
    environmentId,
    requests: vi.fn(),
    subscribe: vi.fn(),
  } satisfies EnvironmentConnection & {
    readonly disconnect: PromiseWithResolvers<void>;
  };
}

async function expectState(
  getSnapshot: () => LocalEnvironmentSessionState,
  tag: LocalEnvironmentSessionState["_tag"],
) {
  await expect.poll(() => getSnapshot()._tag).toBe(tag);
}
