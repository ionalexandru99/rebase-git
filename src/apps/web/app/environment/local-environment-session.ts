import type { EnvironmentCredential } from "@rebase/environment-client";
import {
  EnvironmentAccessDenied,
  type EnvironmentConnectionFailure,
  EnvironmentHelloRejected,
} from "@rebase/environment-client";
import { Effect, Fiber, Result } from "effect";
import type { EnvironmentProtocolConnection } from "#web/app/environment/connection/environment-protocol-connection.contract";
import type {
  ConnectedFeature,
  LocalEnvironmentSession,
  LocalEnvironmentSessionOptions,
  LocalEnvironmentSessionState,
} from "#web/app/environment/local-environment-session.contract";
import type { EnvironmentChangeListener } from "#web/platform/environment/environment-protocol.contract";
import { createStore } from "#web/platform/store/store";

export function createLocalEnvironmentSession(
  options: LocalEnvironmentSessionOptions,
): LocalEnvironmentSession {
  const state = createStore<LocalEnvironmentSessionState>({
    _tag: "Authorizing",
  });
  const changeListeners = new Set<EnvironmentChangeListener>();
  let credential: EnvironmentCredential | undefined;
  let fiber: Fiber.Fiber<void, never> | undefined;
  let running = false;

  const publish: PublishState = (next) => Effect.sync(() => state.set(next));

  const runSession = Effect.gen(function* () {
    if (credential === undefined) {
      credential = yield* authorizeSession(options, publish);
    }
    yield* maintainConnection(
      options,
      credential,
      publish,
      (repositoryIds, kind) => {
        for (const listener of changeListeners) listener(repositoryIds, kind);
      },
    );
  });

  const start = () => {
    if (running) {
      return;
    }

    running = true;
    fiber = options.runtime.runFork(
      Effect.scoped(runSession).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            running = false;
            fiber = undefined;
          }),
        ),
      ),
    );
  };

  const stop = () => {
    if (!running) {
      return;
    }
    const activeFiber = fiber;
    if (activeFiber !== undefined) {
      options.runtime.runFork(Fiber.interrupt(activeFiber));
    }
  };

  return {
    ...options.controllers,
    requests: options.requests,
    changes: {
      subscribe: (listener) => {
        changeListeners.add(listener);
        return () => changeListeners.delete(listener);
      },
    },
    getSnapshot: state.getSnapshot,
    runtime: options.runtime,
    start,
    stop,
    subscribe: state.subscribe,
  };
}

function authorizeSession(
  options: LocalEnvironmentSessionOptions,
  publish: PublishState,
): Effect.Effect<EnvironmentCredential> {
  return Effect.gen(function* () {
    let attempt = 0;
    while (true) {
      yield* attempt === 0
        ? publish({ _tag: "Authorizing" })
        : reconnectAfter(options, publish, attempt);
      const authorized = yield* Effect.result(options.gateway.authorize());
      if (Result.isSuccess(authorized)) {
        return authorized.success;
      }

      const terminal =
        authorized.failure instanceof EnvironmentAccessDenied &&
        authorized.failure.failure._tag === "InvalidGrant"
          ? { _tag: "PairingRequired" as const }
          : terminalState(authorized.failure);
      if (terminal !== undefined) {
        yield* publish(terminal);
        return yield* Effect.interrupt;
      }
      attempt += 1;
    }
  });
}

function maintainConnection(
  options: LocalEnvironmentSessionOptions,
  credential: EnvironmentCredential,
  publish: PublishState,
  publishChanges: EnvironmentChangeListener,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    let attempt = 0;
    let environmentId: string | undefined;
    let lastObservedSequence: number | undefined;
    while (true) {
      yield* attempt === 0
        ? publish({ _tag: "Connecting" })
        : reconnectAfter(options, publish, attempt, environmentId);
      const connection = yield* Effect.result(
        Effect.scoped(
          options.gateway.connect(credential, lastObservedSequence).pipe(
            Effect.tap((active) =>
              Effect.sync(() => {
                environmentId = active.negotiated.environmentId;
              }),
            ),
            Effect.tap((active) =>
              attachFeatures(options.features, active, publishChanges),
            ),
            Effect.tap((active) =>
              publish({
                _tag: "Connected",
                environmentId: active.negotiated.environmentId,
                accessCapabilities: active.negotiated.accessCapabilities ?? [],
              }),
            ),
            Effect.flatMap((active) =>
              active.closed.pipe(
                Effect.map((failure) => ({
                  failure,
                  lastObservedSequence: active.currentSequence(),
                })),
              ),
            ),
          ),
        ),
      );
      const failure = Result.isFailure(connection)
        ? connection.failure
        : connection.success.failure;
      const terminal = terminalState(failure);
      if (terminal !== undefined) {
        yield* publish(terminal);
        return yield* Effect.interrupt;
      }

      if (Result.isSuccess(connection)) {
        lastObservedSequence = connection.success.lastObservedSequence;
        attempt = 1;
      } else {
        attempt += 1;
      }
    }
  });
}

function attachFeatures(
  features: readonly ConnectedFeature[],
  connection: EnvironmentProtocolConnection,
  publishChanges: EnvironmentChangeListener,
) {
  return Effect.acquireRelease(
    Effect.sync(() =>
      connection.subscribeChanges((repositoryIds, kind) => {
        if (kind !== "Index")
          for (const feature of features) feature.invalidate?.(repositoryIds);
        publishChanges(repositoryIds, kind);
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  ).pipe(
    Effect.andThen(
      Effect.forEach(features, (feature) => feature.connect(connection), {
        discard: true,
      }),
    ),
  );
}

function reconnectAfter(
  options: LocalEnvironmentSessionOptions,
  publish: PublishState,
  attempt: number,
  environmentId?: string,
) {
  const delay = Math.min(250 * 2 ** (attempt - 1), 5_000);
  return publish({
    _tag: "Reconnecting",
    attempt,
    ...(environmentId === undefined ? {} : { environmentId }),
  }).pipe(
    Effect.andThen(
      options.waitBeforeReconnect?.(attempt) ?? Effect.sleep(delay),
    ),
  );
}

function terminalState(
  failure: EnvironmentConnectionFailure,
): LocalEnvironmentSessionState | undefined {
  if (failure instanceof EnvironmentAccessDenied) {
    return { _tag: "AuthorizationFailed", failure };
  }
  if (failure instanceof EnvironmentHelloRejected) {
    return {
      _tag: "ProtocolMismatch",
      message: protocolMismatchMessage(failure),
    };
  }
  return undefined;
}

function protocolMismatchMessage(failure: EnvironmentHelloRejected) {
  if (
    failure.failure._tag === "ProtocolMajorMismatch" &&
    failure.failure.requiredUpdate === "server"
  ) {
    return "The local Rebase server is older than this browser client. Update the local package and restart Rebase.";
  }
  return "This browser client cannot use the local Rebase protocol. Reload the page, then update the local package if the mismatch remains.";
}

type PublishState = (
  state: LocalEnvironmentSessionState,
) => Effect.Effect<void>;
