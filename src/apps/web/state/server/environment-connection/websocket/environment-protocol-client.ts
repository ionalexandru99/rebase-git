import {
  createCurrentEnvironmentHello,
  type EnvironmentDiscovery,
  type EnvironmentHello,
} from "@rebase/contracts";
import {
  type EnvironmentConnectionFailure,
  EnvironmentHelloRejected,
  EnvironmentResponseError,
  environmentResponseError,
} from "@rebase/web/state/server/environment-connection/environment-connection-errors";
import {
  fetchEnvironmentDiscovery,
  fetchEnvironmentDiscoveryEffect,
  fetchEnvironmentSnapshot,
} from "@rebase/web/state/server/environment-connection/http/environment-http-client";
import {
  createEnvironmentConnectionState,
  type EnvironmentConnectionState,
  terminateEnvironmentConnection,
  waitForEnvironmentSequence,
} from "@rebase/web/state/server/environment-connection/websocket/environment-connection-state";
import { processEnvironmentServerMessages } from "@rebase/web/state/server/environment-connection/websocket/environment-live-session";
import type { EnvironmentProtocolConnection } from "@rebase/web/state/server/environment-connection/websocket/environment-protocol-connection.contract";
import {
  acquireEnvironmentSocket,
  acquireEnvironmentSocketEvents,
  readEnvironmentHelloResult,
} from "@rebase/web/state/server/environment-connection/websocket/environment-socket";
import { Deferred, Effect, Ref } from "effect";

export {
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
    readonly lastObservedSequence?: number;
    readonly signal?: AbortSignal;
  } = {},
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const discovery = yield* fetchEnvironmentDiscoveryEffect(origin);
      return yield* startEnvironmentConnection(
        origin,
        discovery,
        createCurrentEnvironmentHello(
          productVersion,
          options.lastObservedSequence,
        ),
        options.signal,
      );
    }),
    options.signal === undefined ? undefined : { signal: options.signal },
  );
}

export function connectEnvironment(
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  signal?: AbortSignal,
): Promise<EnvironmentProtocolConnection> {
  return Effect.runPromise(
    startEnvironmentConnection(origin, discovery, hello, signal),
    signal === undefined ? undefined : { signal },
  );
}

function startEnvironmentConnection(
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  externalSignal?: AbortSignal,
) {
  return Effect.gen(function* () {
    const connected = yield* Deferred.make<
      EnvironmentProtocolConnection,
      EnvironmentConnectionFailure
    >();
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
      signal,
      closeController,
      connected,
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
      Effect.forkDetach,
    );

    return yield* Deferred.await(connected);
  });
}

function runEnvironmentConnection(
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  signal: AbortSignal,
  closeController: AbortController,
  connected: Deferred.Deferred<
    EnvironmentProtocolConnection,
    EnvironmentConnectionFailure
  >,
  state: Ref.Ref<EnvironmentConnectionState>,
) {
  return Effect.gen(function* () {
    const socketUrl = new URL(discovery.routes.live, normalizeOrigin(origin));
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
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
    yield* initializeEnvironmentSequence(state, hello, negotiated);
    yield* publishEnvironmentConnection(
      connected,
      state,
      discovery,
      negotiated,
      closeController,
    );
    yield* processEnvironmentServerMessages({
      discovery,
      events,
      hello,
      negotiated,
      origin,
      signal,
      socket,
      state,
    });
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
  state: Ref.Ref<EnvironmentConnectionState>,
  discovery: EnvironmentDiscovery,
  negotiated: EnvironmentProtocolConnection["negotiated"],
  closeController: AbortController,
) {
  return Deferred.succeed(connected, {
    close: () => closeController.abort(environmentResponseError("WebSocket")),
    currentSequence: () => Ref.getUnsafe(state).currentSequence,
    discovery,
    negotiated,
    waitForSequence: (sequence) =>
      Effect.runPromise(waitForEnvironmentSequence(state, sequence)),
  });
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
