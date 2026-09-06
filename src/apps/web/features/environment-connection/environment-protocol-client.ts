import {
  createCurrentEnvironmentHello,
  type EnvironmentDiscovery,
  type EnvironmentHello,
} from "@rebase/contracts";
import { Deferred, Effect, Ref } from "effect";
import {
  EnvironmentAuthorizationRejected,
  type EnvironmentConnectionFailure,
  EnvironmentHelloRejected,
  EnvironmentResponseError,
  environmentResponseError,
} from "#web/features/environment-connection/environment-connection-errors";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import type { EnvironmentProtocolConnection } from "#web/features/environment-connection/environment-protocol-connection.contract";
import {
  fetchEnvironmentDiscovery,
  fetchEnvironmentDiscoveryEffect,
  fetchEnvironmentSnapshot,
  mintEnvironmentWebSocketTicketEffect,
} from "#web/features/environment-connection/http/environment-http-client";
import {
  createEnvironmentConnectionState,
  type EnvironmentConnectionState,
  terminateEnvironmentConnection,
  waitForEnvironmentSequence,
} from "#web/features/environment-connection/websocket/environment-connection-state";
import { processEnvironmentServerMessages } from "#web/features/environment-connection/websocket/environment-live-session";
import {
  acquireEnvironmentSocket,
  acquireEnvironmentSocketEvents,
  readEnvironmentHelloResult,
} from "#web/features/environment-connection/websocket/environment-socket";
import { createRepositoryHistoryTransport } from "#web/features/repository-history/transport/repository-history-transport";
import { createRepositoryRefsTransport } from "#web/features/repository-refs/transport/repository-refs-transport";

export {
  EnvironmentAuthorizationRejected,
  EnvironmentHelloRejected,
  type EnvironmentProtocolConnection,
  EnvironmentResponseError,
  fetchEnvironmentDiscovery,
  fetchEnvironmentSnapshot,
};

export function connectCurrentEnvironment(
  origin: string,
  productVersion: string,
  options: {
    readonly credential: EnvironmentCredential;
    readonly lastObservedSequence?: number;
    readonly signal?: AbortSignal;
  },
) {
  return Effect.runPromise(
    openCurrentEnvironmentConnection(
      origin,
      productVersion,
      options,
      options.signal,
    ),
    options.signal === undefined ? undefined : { signal: options.signal },
  );
}

export function connectCurrentEnvironmentEffect(
  origin: string,
  productVersion: string,
  options: {
    readonly credential: EnvironmentCredential;
    readonly lastObservedSequence?: number;
  },
) {
  return Effect.acquireRelease(
    openCurrentEnvironmentConnection(origin, productVersion, options),
    closeEnvironmentConnection,
  );
}

function openCurrentEnvironmentConnection(
  origin: string,
  productVersion: string,
  options: {
    readonly credential: EnvironmentCredential;
    readonly lastObservedSequence?: number;
  },
  signal?: AbortSignal,
) {
  return Effect.gen(function* () {
    const discovery = yield* fetchEnvironmentDiscoveryEffect(origin);
    return yield* startEnvironmentConnection(
      origin,
      discovery,
      createCurrentEnvironmentHello(
        productVersion,
        options.lastObservedSequence,
      ),
      options.credential,
      signal,
    );
  });
}

export function connectEnvironment(
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  credential: EnvironmentCredential,
  signal?: AbortSignal,
): Promise<EnvironmentProtocolConnection> {
  return Effect.runPromise(
    openEnvironmentConnection(origin, discovery, hello, credential, signal),
    signal === undefined ? undefined : { signal },
  );
}

export function connectEnvironmentEffect(
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  credential: EnvironmentCredential,
) {
  return Effect.acquireRelease(
    openEnvironmentConnection(origin, discovery, hello, credential),
    closeEnvironmentConnection,
  );
}

function openEnvironmentConnection(
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  credential: EnvironmentCredential,
  signal?: AbortSignal,
) {
  return startEnvironmentConnection(
    origin,
    discovery,
    hello,
    credential,
    signal,
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
  externalSignal?: AbortSignal,
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
    const signal =
      externalSignal === undefined
        ? closeController.signal
        : AbortSignal.any([externalSignal, closeController.signal]);

    yield* runEnvironmentConnection(
      origin,
      discovery,
      hello,
      credential,
      signal,
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
      Effect.forkDetach,
    );

    return yield* Deferred.await(connected).pipe(
      Effect.onInterrupt(() => Effect.sync(() => closeController.abort())),
    );
  });
}

function runEnvironmentConnection(
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  credential: EnvironmentCredential,
  signal: AbortSignal,
  closeController: AbortController,
  connected: Deferred.Deferred<
    EnvironmentProtocolConnection,
    EnvironmentConnectionFailure
  >,
  closed: Deferred.Deferred<EnvironmentConnectionFailure>,
  state: Ref.Ref<EnvironmentConnectionState>,
) {
  return Effect.gen(function* () {
    const ticket = yield* mintEnvironmentWebSocketTicketEffect(
      origin,
      credential,
      signal,
    );
    const socketUrl = new URL(discovery.routes.live, normalizeOrigin(origin));
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.searchParams.set("ticket", ticket.ticket);
    const socket = yield* acquireEnvironmentSocket(socketUrl, signal);
    const events = yield* acquireEnvironmentSocketEvents(
      socket,
      signal,
      discovery,
    );
    const negotiated = yield* readEnvironmentHelloResult(
      socket,
      events,
      hello,
      discovery,
    );
    const supportsJsonFragmentation = negotiated.capabilities.some(
      (capability) => capability.name === "json-fragmentation",
    );
    const repositoryHistoryVersion = negotiated.capabilities.find(
      (capability) => capability.name === "repository-history",
    )?.version;
    const repositoryHistory = createRepositoryHistoryTransport(
      socket,
      (repositoryHistoryVersion ?? 0) >= 6 && supportsJsonFragmentation,
      (repositoryHistoryVersion ?? 0) >= 6 && supportsJsonFragmentation,
      negotiated.capabilities.some(
        (capability) => capability.name === "repository-history-freshness",
      ),
    );
    yield* initializeEnvironmentSequence(state, hello, negotiated);
    const repositoryRefs = createRepositoryRefsTransport(
      socket,
      supportsJsonFragmentation &&
        negotiated.capabilities.some(
          (capability) => capability.name === "repository-refs",
        ),
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
    yield* processEnvironmentServerMessages({
      discovery,
      credential,
      events,
      hello,
      negotiated,
      origin,
      signal,
      socket,
      state,
      repositoryHistory,
      repositoryRefs,
    }).pipe(
      Effect.ensuring(
        repositoryHistory.close(environmentResponseError("WebSocket")),
      ),
      Effect.ensuring(repositoryRefs.close),
    );
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
  repositoryHistory: ReturnType<typeof createRepositoryHistoryTransport>,
  repositoryRefs: ReturnType<typeof createRepositoryRefsTransport>,
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

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
