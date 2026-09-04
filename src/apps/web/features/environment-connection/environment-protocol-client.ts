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
import { createRepositoryHistoryTransport } from "#web/features/repository-history/repository-history-transport";

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
    readonly credential: string;
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
    readonly credential: string;
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
    readonly credential: string;
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
  credential: string,
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
  credential: string,
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
  credential: string,
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
  credential: string,
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
  credential: string,
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
    const supportsBinaryFragmentation = negotiated.capabilities.some(
      (capability) => capability.name === "binary-fragmentation",
    );
    const repositoryHistoryVersion = negotiated.capabilities.find(
      (capability) => capability.name === "repository-history",
    )?.version;
    const repositoryHistory = createRepositoryHistoryTransport(
      socket,
      repositoryHistoryVersion !== undefined && supportsBinaryFragmentation,
      (repositoryHistoryVersion ?? 0) >= 2 && supportsBinaryFragmentation,
    );
    yield* initializeEnvironmentSequence(state, hello, negotiated);
    yield* publishEnvironmentConnection(
      connected,
      closed,
      state,
      repositoryHistory,
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
    }).pipe(
      Effect.ensuring(
        repositoryHistory.close(environmentResponseError("WebSocket")),
      ),
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
    waitForSequence: (sequence) => waitForEnvironmentSequence(state, sequence),
  });
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
