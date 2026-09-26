import {
  createCurrentEnvironmentDiscovery,
  createCurrentEnvironmentHello,
  type EnvironmentAccessCapability,
  type EnvironmentRpcClient,
  negotiateEnvironmentHello,
} from "@rebase/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentAccessDenied,
  EnvironmentHelloRejected,
  type EnvironmentProtocolConnection,
  EnvironmentResponseError,
} from "#web/app/environment/connection/index";
import { createLocalEnvironmentSession } from "#web/app/environment/local-environment-session";
import type {
  ConnectedFeature,
  LocalEnvironmentControllers,
  LocalEnvironmentGateway,
  LocalEnvironmentSessionOptions,
  LocalEnvironmentSessionState,
} from "#web/app/environment/local-environment-session.contract";

const runtime = ManagedRuntime.make(Layer.empty);

describe("local Environment session", () => {
  it("connects each feature, forwards change events, invalidates features only for ref changes, and releases them on disconnect", async () => {
    const connection = createConnection();
    const release = vi.fn();
    connection.subscribeChanges.mockReturnValue(release);
    const feature = createFeature();
    const changed = vi.fn();
    const session = createSession({
      features: [feature],
      gateway: createGateway(connection),
    });
    session.changes.subscribe(changed);

    session.start();
    try {
      await expectState(session.getSnapshot, "Connected");
      expect(feature.connect).toHaveBeenCalledExactlyOnceWith(connection);
      expect(feature.released).not.toHaveBeenCalled();
      const publish = connection.subscribeChanges.mock.calls[0]?.[0];
      publish?.(["changed"], "Refs");
      expect(feature.invalidate).toHaveBeenCalledExactlyOnceWith(["changed"]);
      expect(changed).toHaveBeenCalledExactlyOnceWith(["changed"], "Refs");
      publish?.(["changed"], "Index");
      expect(feature.invalidate).toHaveBeenCalledOnce();
      expect(changed).toHaveBeenLastCalledWith(["changed"], "Index");
    } finally {
      session.stop();
    }
    await vi.waitFor(() => expect(feature.released).toHaveBeenCalledOnce());
    expect(release).toHaveBeenCalledOnce();
  });

  it("authorizes before opening the initial connection", async () => {
    const connection = createConnection();
    const gateway = createGateway(connection);
    const session = createSession({ gateway });

    session.start();
    await expectState(session.getSnapshot, "Connected");

    expect(session.getSnapshot()).toMatchObject({ accessCapabilities: [] });

    expect(gateway.authorize).toHaveBeenCalledOnce();
    expect(gateway.connect).toHaveBeenCalledWith(
      { type: "bearer", value: "device-credential" },
      undefined,
    );
    session.stop();
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce());
  });

  it.each(["InvalidGrant", "RevokedGrant"] as const)(
    "stops when authorization fails with %s",
    async (failure) => {
      const gateway = createGateway();
      gateway.authorize.mockReturnValue(
        Effect.fail(
          new EnvironmentAccessDenied({
            failure: { _tag: failure },
            status: 401,
          }),
        ),
      );
      const session = createSession({ gateway });

      session.start();
      try {
        await expectState(
          session.getSnapshot,
          failure === "InvalidGrant"
            ? "PairingRequired"
            : "AuthorizationFailed",
        );
        expect(gateway.authorize).toHaveBeenCalledOnce();
        expect(gateway.connect).not.toHaveBeenCalled();
      } finally {
        session.stop();
      }
    },
  );

  it("owns one reconnect after the active connection closes", async () => {
    const initial = createConnection(7, [
      "repository.read",
      "repository.write",
    ]);
    const reconnected = createConnection(8, ["repository.read"]);
    const gateway = createGateway(initial, reconnected);
    const feature = createFeature();
    const reconnect = deferred<void>();
    const waitBeforeReconnect = vi.fn(() =>
      Effect.promise(() => reconnect.promise),
    );
    const session = createSession({
      features: [feature],
      gateway,
      waitBeforeReconnect,
    });

    session.start();
    await expectState(session.getSnapshot, "Connected");
    expect(session.getSnapshot()).toMatchObject({
      accessCapabilities: ["repository.read", "repository.write"],
    });
    initial.disconnect.resolve(
      new EnvironmentResponseError({ responseTag: "WebSocket" }),
    );
    await expectState(session.getSnapshot, "Reconnecting");
    expect(session.getSnapshot()).toMatchObject({
      _tag: "Reconnecting",
      environmentId: "00000000-0000-4000-8000-000000000001",
    });
    expect(gateway.connect).toHaveBeenCalledTimes(1);
    expect(feature.released).toHaveBeenCalledOnce();

    reconnect.resolve();
    await expectState(session.getSnapshot, "Connected");
    expect(session.getSnapshot()).toMatchObject({
      accessCapabilities: ["repository.read"],
    });
    expect(gateway.connect).toHaveBeenNthCalledWith(
      2,
      { type: "bearer", value: "device-credential" },
      7,
    );
    expect(waitBeforeReconnect).toHaveBeenCalledOnce();
    expect(feature.connect).toHaveBeenNthCalledWith(2, reconnected);
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
    const feature = createFeature();
    const session = createSession({
      features: [feature],
      gateway,
      waitBeforeReconnect,
    });

    session.start();
    await expectState(session.getSnapshot, "ProtocolMismatch");

    expect(gateway.connect).toHaveBeenCalledOnce();
    expect(waitBeforeReconnect).not.toHaveBeenCalled();
    expect(feature.connect).not.toHaveBeenCalled();
    session.stop();
  });
});

function createSession(
  options: Partial<LocalEnvironmentSessionOptions> &
    Pick<LocalEnvironmentSessionOptions, "gateway">,
) {
  return createLocalEnvironmentSession({
    controllers: unusedControllers,
    features: [],
    requests: async () => {
      throw new Error("Session tests do not send requests.");
    },
    runtime,
    ...options,
  });
}

function createFeature() {
  const released = vi.fn();
  const connect = vi.fn<ConnectedFeature["connect"]>(() =>
    Effect.acquireRelease(Effect.void, () => Effect.sync(released)),
  );
  return {
    connect,
    invalidate: vi.fn<NonNullable<ConnectedFeature["invalidate"]>>(),
    released,
  } satisfies ConnectedFeature & { readonly released: typeof released };
}

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
    authorize: vi.fn<LocalEnvironmentGateway["authorize"]>(() =>
      Effect.succeed({ type: "bearer", value: "device-credential" }),
    ),
  } satisfies LocalEnvironmentGateway & {
    connect: ReturnType<typeof vi.fn<LocalEnvironmentGateway["connect"]>>;
    authorize: ReturnType<typeof vi.fn<LocalEnvironmentGateway["authorize"]>>;
  };
}

const unusedControllers: LocalEnvironmentControllers = {
  filesystem: {
    listDirectory: () => Promise.reject(new Error("Unused")),
  },
  repositoryCatalog: {
    getSnapshot: () => ({ repositories: [], status: "idle" }),
    recordOpened: () => Promise.reject(new Error("Unused")),
    refresh: () => Promise.reject(new Error("Unused")),
    remember: () => Promise.reject(new Error("Unused")),
    remove: () => Promise.reject(new Error("Unused")),
    subscribe: () => () => undefined,
  },
  repositoryHistory: {
    read: () => Promise.reject(new Error("Unused")),
    synchronize: () => Promise.reject(new Error("Unused")),
  },
  repositoryRefs: {
    apply: () => undefined,
    checkout: () => Promise.reject(new Error("Unused")),
    getSnapshot: () => ({ checkingOut: false, status: "idle" }),
    invalidate: () => undefined,
    refresh: () => Promise.reject(new Error("Unused")),
    select: () => undefined,
    subscribe: () => () => undefined,
  },
};

function createConnection(
  currentSequence = 0,
  accessCapabilities?: readonly EnvironmentAccessCapability[],
) {
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
    negotiated: {
      ...negotiated,
      ...(accessCapabilities === undefined ? {} : { accessCapabilities }),
    },
    rpc: {} as EnvironmentRpcClient,
    waitForSequence: vi.fn(() => Effect.never),
    subscribeChanges: vi.fn<EnvironmentProtocolConnection["subscribeChanges"]>(
      () => () => {},
    ),
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
