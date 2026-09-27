import { environmentProtocol } from "@rebase/contracts";
import {
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Result,
  type Scope,
} from "effect";
import {
  EnvironmentAccessDenied,
  type EnvironmentConnection,
  type EnvironmentConnectionFailure,
  type EnvironmentCredential,
  EnvironmentProtocolMismatch,
  environmentRequests,
} from "#web/platform/environment/environment-connection";
import type { EnvironmentRequests } from "#web/platform/query/environment-context";
import type { EnvironmentInvalidation } from "#web/platform/query/environment-invalidation";
import { createStore, type ReadableStore } from "#web/platform/store/store";

export type LocalEnvironmentSessionState =
  | { readonly _tag: "PairingRequired" }
  | { readonly _tag: "Authorizing" }
  | { readonly _tag: "Connecting" }
  | {
      readonly _tag: "Connected";
      readonly environmentId: string;
      readonly requests: EnvironmentRequests;
    }
  | {
      readonly _tag: "Reconnecting";
      readonly attempt: number;
      readonly environmentId?: string;
    }
  | {
      readonly _tag: "AuthorizationFailed";
      readonly failure: EnvironmentAccessDenied;
    }
  | {
      readonly _tag: "ProtocolMismatch";
      readonly message: string;
    };

export interface LocalEnvironmentSession
  extends ReadableStore<LocalEnvironmentSessionState> {
  readonly start: () => void;
  readonly stop: () => void;
}

export interface LocalEnvironmentGateway {
  readonly authorize: () => Effect.Effect<
    EnvironmentCredential,
    EnvironmentConnectionFailure
  >;
  readonly connect: (
    credential: EnvironmentCredential,
  ) => Effect.Effect<
    EnvironmentConnection,
    EnvironmentConnectionFailure,
    Scope.Scope
  >;
}

export interface LocalEnvironmentSessionOptions {
  readonly gateway: LocalEnvironmentGateway;
  readonly invalidation: EnvironmentInvalidation;
  readonly onConnect?: (credential: EnvironmentCredential) => void;
  readonly waitBeforeReconnect?: (attempt: number) => Effect.Effect<void>;
}

type PublishState = (
  state: LocalEnvironmentSessionState,
) => Effect.Effect<void>;

export function createLocalEnvironmentSession(
  options: LocalEnvironmentSessionOptions,
): LocalEnvironmentSession {
  const state = createStore<LocalEnvironmentSessionState>({
    _tag: "Authorizing",
  });
  let credential: EnvironmentCredential | undefined;
  let fiber: Fiber.Fiber<void, never> | undefined;
  const runtime = ManagedRuntime.make(Layer.empty);
  const publish: PublishState = (next) => Effect.sync(() => state.set(next));

  const runSession = Effect.gen(function* () {
    credential ??= yield* authorizeSession(options, publish);
    yield* maintainConnection(options, credential, publish);
  });

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    start: () => {
      if (fiber !== undefined) return;
      fiber = runtime.runFork(
        runSession.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              fiber = undefined;
            }),
          ),
        ),
      );
    },
    stop: () => {
      if (fiber !== undefined) runtime.runFork(Fiber.interrupt(fiber));
    },
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
      if (Result.isSuccess(authorized)) return authorized.success;
      const terminal = terminalState(authorized.failure, {
        type: "browser-session",
      });
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
): Effect.Effect<void> {
  return Effect.gen(function* () {
    let attempt = 0;
    let environmentId: string | undefined;
    while (true) {
      yield* attempt === 0
        ? publish({ _tag: "Connecting" })
        : reconnectAfter(options, publish, attempt, environmentId);
      const connection = yield* Effect.result(
        Effect.scoped(
          options.gateway.connect(credential).pipe(
            Effect.tap((active) =>
              Effect.sync(() => {
                environmentId = active.environmentId;
              }),
            ),
            Effect.tap(() =>
              Effect.sync(() => options.onConnect?.(credential)),
            ),
            Effect.tap((active) =>
              Effect.sync(() => options.invalidation.changed()).pipe(
                Effect.andThen(
                  publish({
                    _tag: "Connected",
                    environmentId: active.environmentId,
                    requests: environmentRequests(active.rpc),
                  }),
                ),
              ),
            ),
            Effect.flatMap((active) => active.closed),
          ),
        ),
      );
      const failure = Result.isFailure(connection)
        ? connection.failure
        : connection.success;
      const terminal = terminalState(failure, credential);
      if (terminal !== undefined) {
        yield* publish(terminal);
        return yield* Effect.interrupt;
      }
      attempt = Result.isSuccess(connection) ? 1 : attempt + 1;
    }
  });
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
  credential: EnvironmentCredential,
): LocalEnvironmentSessionState | undefined {
  if (failure instanceof EnvironmentAccessDenied)
    return failure.failure._tag === "InvalidGrant" &&
      credential.type === "browser-session"
      ? { _tag: "PairingRequired" }
      : { _tag: "AuthorizationFailed", failure };
  if (failure instanceof EnvironmentProtocolMismatch)
    return {
      _tag: "ProtocolMismatch",
      message:
        failure.serverProtocol < environmentProtocol
          ? "The local Rebase server is older than this browser client. Update the local package and restart Rebase."
          : "This browser client cannot use the local Rebase protocol. Reload the page, then update the local package if the mismatch remains.",
    };
  return undefined;
}
