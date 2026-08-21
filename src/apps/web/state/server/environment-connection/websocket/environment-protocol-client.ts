import {
  createCurrentEnvironmentHello,
  type EnvironmentDiscovery,
  type EnvironmentHello,
  SnapshotApplied,
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
  fetchEnvironmentSnapshotWithinLimitEffect,
} from "@rebase/web/state/server/environment-connection/http/environment-http-client";
import {
  createEnvironmentConnectionState,
  type EnvironmentConnectionState,
  terminateEnvironmentConnection,
  updateEnvironmentSequence,
  waitForEnvironmentSequence,
} from "@rebase/web/state/server/environment-connection/websocket/environment-connection-state";
import type {
  EnvironmentProtocolConnection,
  NegotiatedEnvironment,
} from "@rebase/web/state/server/environment-connection/websocket/environment-protocol-connection.contract";
import { advanceEnvironmentSequence } from "@rebase/web/state/server/environment-connection/websocket/environment-sequence";
import {
  acquireEnvironmentSocket,
  acquireEnvironmentSocketEvents,
  decodeEnvironmentServerMessage,
  readEnvironmentHelloResult,
  sendEnvironmentSocketMessage,
} from "@rebase/web/state/server/environment-connection/websocket/environment-socket";
import { Deferred, Effect, Queue, Ref } from "effect";

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
    const supportsEnvironmentEvents = negotiated.capabilities.some(
      (capability) => capability.name === "environment-events",
    );
    const supportsResnapshot = negotiated.capabilities.some(
      (capability) => capability.name === "sequence-resnapshot",
    );
    yield* Ref.update(state, (current) => ({
      ...current,
      currentSequence: supportsResnapshot
        ? (hello.lastObservedSequence ?? negotiated.currentSequence)
        : negotiated.currentSequence,
    }));
    yield* Deferred.succeed(connected, {
      close: () => closeController.abort(environmentResponseError("WebSocket")),
      currentSequence: () => Ref.getUnsafe(state).currentSequence,
      discovery,
      negotiated,
      waitForSequence: (sequence) =>
        Effect.runPromise(waitForEnvironmentSequence(state, sequence)),
    });

    while (true) {
      const event = yield* Queue.take(events);
      if (event._tag !== "Message") {
        return yield* Effect.fail(environmentResponseError("WebSocket"));
      }
      const message = yield* decodeEnvironmentServerMessage(
        event.event,
        hello,
        negotiated,
      );
      if (message._tag === "EnvironmentChanged") {
        if (!supportsEnvironmentEvents) {
          return yield* Effect.fail(environmentResponseError("WebSocket"));
        }
        const advanced = advanceEnvironmentSequence(
          Ref.getUnsafe(state).currentSequence,
          message.sequence,
        );
        if (advanced._tag === "SequenceAccepted") {
          yield* updateEnvironmentSequence(state, advanced.sequence);
        } else {
          yield* recoverEnvironmentSnapshot(
            socket,
            state,
            origin,
            discovery,
            hello,
            negotiated,
            message.sequence,
            signal,
          );
        }
      } else if (message._tag === "ResnapshotRequired") {
        if (!supportsResnapshot) {
          return yield* Effect.fail(environmentResponseError("WebSocket"));
        }
        yield* recoverEnvironmentSnapshot(
          socket,
          state,
          origin,
          discovery,
          hello,
          negotiated,
          message.currentSequence,
          signal,
        );
      } else {
        return yield* Effect.fail(environmentResponseError("WebSocket"));
      }
    }
  });
}

function recoverEnvironmentSnapshot(
  socket: WebSocket,
  state: Ref.Ref<EnvironmentConnectionState>,
  origin: string,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  negotiated: NegotiatedEnvironment,
  minimumSequence: number,
  signal: AbortSignal,
) {
  return Effect.gen(function* () {
    const snapshot = yield* fetchEnvironmentSnapshotWithinLimitEffect(
      origin,
      discovery,
      Math.min(
        negotiated.limits.maxHttpResponseBytes,
        hello.receiveLimits.maxHttpResponseBytes,
      ),
      signal,
    );
    if (snapshot.sequence < minimumSequence) {
      return yield* Effect.fail(environmentResponseError("Snapshot"));
    }
    yield* updateEnvironmentSequence(state, snapshot.sequence);
    yield* sendEnvironmentSocketMessage(socket, SnapshotApplied, {
      _tag: "SnapshotApplied",
      sequence: snapshot.sequence,
    });
  });
}

function normalizeOrigin(origin: string) {
  return origin.endsWith("/") ? origin : `${origin}/`;
}
