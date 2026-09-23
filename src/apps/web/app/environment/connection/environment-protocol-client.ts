import {
  createCurrentEnvironmentHello,
  type EnvironmentDiscovery,
  type EnvironmentHello,
  negotiateEnvironmentHello,
} from "@rebase/contracts";
import type { EnvironmentCredential } from "@rebase/environment-client";
import {
  type EnvironmentConnectionFailure,
  EnvironmentHelloRejected,
  environmentResponseError,
  fetchEnvironmentDiscoveryEffect,
  mintEnvironmentWebSocketTicketEffect,
} from "@rebase/environment-client";
import { Deferred, Effect, Fiber, Ref } from "effect";
import type { EnvironmentProtocolConnection } from "#web/app/environment/connection/environment-protocol-connection.contract";
import { createRepositoryHistoryRpc } from "#web/features/repository-history/transport/repository-history-rpc";
import { createRepositoryRefsRpc } from "#web/features/repository-refs/transport/repository-refs-rpc";
import {
  acquireEnvironmentRpc,
  negotiateEnvironmentRpc,
} from "#web/platform/environment/rpc/environment-rpc-client";
import {
  initializeEnvironmentRpcEvents,
  processEnvironmentRpcEvents,
} from "#web/platform/environment/rpc/environment-rpc-events";
import {
  createEnvironmentConnectionState,
  type EnvironmentConnectionState,
  terminateEnvironmentConnection,
  waitForEnvironmentSequence,
} from "#web/platform/environment/websocket/environment-connection-state";

export type { EnvironmentProtocolConnection };

export function connectCurrentEnvironmentEffect(
  origin: string,
  productVersion: string,
  options: {
    readonly credential: EnvironmentCredential;
    readonly lastObservedSequence?: number;
  },
) {
  return acquireEnvironmentConnection(
    fetchEnvironmentDiscoveryEffect(origin).pipe(
      Effect.flatMap((discovery) =>
        startEnvironmentConnection(
          origin,
          discovery,
          createCurrentEnvironmentHello(
            productVersion,
            options.lastObservedSequence,
          ),
          options.credential,
        ),
      ),
    ),
  );
}

export function connectEnvironmentEffect(
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  credential: EnvironmentCredential,
) {
  return acquireEnvironmentConnection(
    startEnvironmentConnection(origin, discovery, hello, credential),
  );
}

function acquireEnvironmentConnection(
  start: Effect.Effect<
    EnvironmentProtocolConnection,
    EnvironmentConnectionFailure
  >,
) {
  return Effect.uninterruptibleMask((restore) =>
    restore(start).pipe(
      Effect.tap((connection) =>
        Effect.addFinalizer(() => closeEnvironmentConnection(connection)),
      ),
    ),
  );
}

function closeEnvironmentConnection(connection: EnvironmentProtocolConnection) {
  return Effect.sync(connection.close).pipe(
    Effect.andThen(connection.closed),
    Effect.asVoid,
  );
}

function startEnvironmentConnection(
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  credential: EnvironmentCredential,
) {
  return Effect.gen(function* () {
    const connected = yield* Deferred.make<
      EnvironmentProtocolConnection,
      EnvironmentConnectionFailure
    >();
    const closed = yield* Deferred.make<EnvironmentConnectionFailure>();
    const state = yield* createEnvironmentConnectionState(
      hello.lastObservedSequence ?? 0,
    );
    const terminalFailure = yield* Ref.make<EnvironmentConnectionFailure>(
      environmentResponseError("WebSocket"),
    );
    const closeController = new AbortController();

    return yield* runEnvironmentConnection(
      origin,
      discovery,
      hello,
      credential,
      closeController,
      connected,
      closed,
      state,
    ).pipe(
      Effect.catch((failure) => Ref.set(terminalFailure, failure)),
      Effect.ensuring(
        Ref.get(terminalFailure).pipe(
          Effect.flatMap((failure) =>
            terminateEnvironmentConnection(connected, state, failure),
          ),
        ),
      ),
      Effect.scoped,
      Effect.ensuring(
        Ref.get(terminalFailure).pipe(
          Effect.flatMap((failure) => Deferred.succeed(closed, failure)),
        ),
      ),
      Effect.interruptible,
      Effect.forkDetach,
      Effect.andThen(Deferred.await(connected)),
      Effect.onInterrupt(() => Effect.sync(() => closeController.abort())),
    );
  });
}

function runEnvironmentConnection(
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  credential: EnvironmentCredential,
  closeController: AbortController,
  connected: Deferred.Deferred<
    EnvironmentProtocolConnection,
    EnvironmentConnectionFailure
  >,
  closed: Deferred.Deferred<EnvironmentConnectionFailure>,
  state: Ref.Ref<EnvironmentConnectionState>,
) {
  const signal = closeController.signal;
  return Effect.gen(function* () {
    const compatibility = negotiateEnvironmentHello(discovery, hello, 0);
    if (compatibility._tag === "HelloRejected")
      return yield* new EnvironmentHelloRejected({
        failure: compatibility.failure,
      });
    const ticket = yield* mintEnvironmentWebSocketTicketEffect(
      origin,
      credential,
      signal,
    );
    const socketUrl = new URL(discovery.routes.live, origin);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.searchParams.set("ticket", ticket.ticket);
    const { client, disconnected } = yield* acquireEnvironmentRpc(
      socketUrl,
      discovery,
      hello,
    );
    const negotiated = yield* negotiateEnvironmentRpc(client, discovery, hello);
    const supportsJsonFragmentation = negotiated.capabilities.some(
      (capability) => capability.name === "json-fragmentation",
    );
    const repositoryHistoryVersion = negotiated.capabilities.find(
      (capability) => capability.name === "repository-history",
    )?.version;
    const repositoryHistory = createRepositoryHistoryRpc(
      client,
      (repositoryHistoryVersion ?? 0) >= 6 && supportsJsonFragmentation,
      negotiated.capabilities.some(
        (capability) => capability.name === "repository-history-freshness",
      ),
    );
    yield* initializeEnvironmentSequence(state, hello, negotiated);
    const repositoryRefs = createRepositoryRefsRpc(
      client,
      supportsJsonFragmentation &&
        negotiated.capabilities.some(
          (capability) => capability.name === "repository-refs",
        ),
    );
    const events = {
      discovery,
      credential,
      client,
      hello,
      negotiated,
      origin,
      signal,
      state,
    };
    yield* initializeEnvironmentRpcEvents(events);
    const watch = yield* processEnvironmentRpcEvents(events).pipe(
      Effect.raceFirst(
        disconnected.pipe(
          Effect.andThen(Effect.fail(environmentResponseError("WebSocket"))),
        ),
      ),
      Effect.forkScoped,
    );
    yield* publishEnvironmentConnection(
      connected,
      closed,
      state,
      repositoryHistory,
      repositoryRefs,
      discovery,
      negotiated,
      closeController,
    );
    yield* Fiber.join(watch);
  }).pipe(Effect.raceFirst(waitForConnectionAbort(signal)));
}

function waitForConnectionAbort(signal: AbortSignal) {
  return Effect.callback<never, EnvironmentConnectionFailure>((resume) => {
    const aborted = () =>
      resume(Effect.fail(environmentResponseError("WebSocket")));
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    return Effect.sync(() => signal.removeEventListener("abort", aborted));
  });
}

function initializeEnvironmentSequence(
  state: Ref.Ref<EnvironmentConnectionState>,
  hello: EnvironmentHello,
  negotiated: EnvironmentProtocolConnection["negotiated"],
) {
  const supportsResnapshot = negotiated.capabilities.some(
    (capability) => capability.name === "sequence-resnapshot",
  );
  return Ref.update(state, (current) => ({
    ...current,
    currentSequence: supportsResnapshot
      ? (hello.lastObservedSequence ?? negotiated.currentSequence)
      : negotiated.currentSequence,
  }));
}

function publishEnvironmentConnection(
  connected: Deferred.Deferred<
    EnvironmentProtocolConnection,
    EnvironmentConnectionFailure
  >,
  closed: Deferred.Deferred<EnvironmentConnectionFailure>,
  state: Ref.Ref<EnvironmentConnectionState>,
  repositoryHistory: ReturnType<typeof createRepositoryHistoryRpc>,
  repositoryRefs: ReturnType<typeof createRepositoryRefsRpc>,
  discovery: EnvironmentDiscovery,
  negotiated: EnvironmentProtocolConnection["negotiated"],
  closeController: AbortController,
) {
  return Deferred.succeed(connected, {
    close: () => closeController.abort(environmentResponseError("WebSocket")),
    closed: Deferred.await(closed),
    currentSequence: () => Ref.getUnsafe(state).currentSequence,
    discovery,
    negotiated,
    repositoryHistory,
    repositoryRefs,
    waitForSequence: (sequence) => waitForEnvironmentSequence(state, sequence),
    subscribeChanges: (listener) => {
      const listeners = Ref.getUnsafe(state).changeListeners;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}
