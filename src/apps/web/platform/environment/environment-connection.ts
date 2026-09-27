import {
  type EnvironmentAccessFailure,
  EnvironmentAuthorizationFailure,
  EnvironmentRpc,
  type EnvironmentRpcClient,
  environmentLivePath,
  environmentProtocol,
  environmentSubprotocol,
  type ProtocolMismatch,
  type RepositoryHistoryUpdate,
  type RouteSuccess,
  type SynchronizeRepositoryHistory,
  unauthorizedCloseCode,
} from "@rebase/contracts";
import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Schedule,
  Schema,
  Scope,
  Stream,
} from "effect";
import {
  RpcClient,
  RpcClientError,
  RpcSerialization,
} from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import type { EnvironmentRequests } from "#web/platform/query/environment-context";
import type { EnvironmentInvalidation } from "#web/platform/query/environment-invalidation";
import type { RequestFailure } from "#web/platform/query/request-failure";

export type EnvironmentCredential =
  | { readonly type: "browser-session" }
  | { readonly type: "bearer"; readonly value: string };

export interface EnvironmentAccess {
  readonly origin: string;
  readonly credential: EnvironmentCredential;
}

export class EnvironmentAccessDenied extends Data.TaggedError(
  "EnvironmentAccessDenied",
)<{ readonly failure: EnvironmentAccessFailure }> {}

export class EnvironmentProtocolMismatch extends Data.TaggedError(
  "EnvironmentProtocolMismatch",
)<{ readonly serverProtocol: number }> {}

export class EnvironmentUnavailable extends Data.TaggedError(
  "EnvironmentUnavailable",
) {}

export type EnvironmentConnectionFailure =
  | EnvironmentAccessDenied
  | EnvironmentProtocolMismatch
  | EnvironmentUnavailable;

export interface EnvironmentConnection {
  readonly environmentId: string;
  readonly rpc: EnvironmentRpcClient;
  readonly closed: Effect.Effect<EnvironmentConnectionFailure>;
}

const decodeAuthorizationFailure = Schema.decodeUnknownOption(
  EnvironmentAuthorizationFailure,
);

export function connectEnvironment(
  origin: string,
  credential: EnvironmentCredential,
  invalidation: EnvironmentInvalidation,
) {
  return Effect.gen(function* () {
    const disconnected = yield* Deferred.make<void>();
    const rpc = yield* openEnvironmentRpc(origin, credential, disconnected);
    const greeting = yield* rpc.Hello({ protocol: environmentProtocol }).pipe(
      Effect.mapError(connectionFailure),
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.fail(new EnvironmentUnavailable()),
      }),
    );
    const watching = yield* Effect.forkScoped(
      watchEnvironment(rpc, greeting.sequence, invalidation),
    );
    return {
      environmentId: greeting.environmentId,
      rpc,
      closed: Deferred.await(disconnected).pipe(
        Effect.raceFirst(Fiber.await(watching)),
        Effect.as(new EnvironmentUnavailable()),
      ),
    } satisfies EnvironmentConnection;
  });
}

export function environmentRequests(
  rpc: EnvironmentRpcClient,
): EnvironmentRequests {
  const procedures = rpc as unknown as Record<
    string,
    (input: unknown) => Effect.Effect<unknown, unknown>
  >;
  return async (route, input, options) => {
    const call = procedures[route._tag];
    if (call === undefined) throw unanswered;
    const exit = await Effect.runPromiseExit(
      call(input),
      options?.signal === undefined ? undefined : { signal: options.signal },
    );
    if (Exit.isSuccess(exit)) return exit.value as RouteSuccess<typeof route>;
    throw requestFailure(exit.cause);
  };
}

export interface EnvironmentSocket {
  readonly environmentId: string;
  readonly requests: EnvironmentRequests;
  readonly synchronizeHistory: (
    request: SynchronizeRepositoryHistory,
    accept: (update: RepositoryHistoryUpdate) => Promise<void>,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly closed: Promise<void>;
  readonly close: () => void;
}

export async function openEnvironmentSocket(
  origin: string,
  credential: EnvironmentCredential,
  invalidation: EnvironmentInvalidation,
): Promise<EnvironmentSocket> {
  const scope = Effect.runSync(Scope.make());
  const close = () => void Effect.runFork(Scope.close(scope, Exit.void));
  const exit = await Effect.runPromiseExit(
    connectEnvironment(origin, credential, invalidation).pipe(
      Scope.provide(scope),
    ),
  );
  if (Exit.isFailure(exit)) {
    close();
    throw unanswered;
  }
  const { environmentId, rpc, closed } = exit.value;
  return {
    environmentId,
    requests: environmentRequests(rpc),
    synchronizeHistory: async (request, accept, signal) => {
      let rejected: { readonly error: unknown } | undefined;
      const result = await Effect.runPromiseExit(
        rpc.SynchronizeHistory(request, { streamBufferSize: 1 }).pipe(
          Stream.runForEach((update) =>
            Effect.tryPromise({
              try: () => accept(update),
              catch: (error) => {
                rejected = { error };
                return error;
              },
            }),
          ),
        ),
        { signal },
      );
      if (rejected !== undefined) throw rejected.error;
      if (Exit.isFailure(result)) throw requestFailure(result.cause);
    },
    closed: Effect.runPromise(closed).then(() => undefined),
    close,
  };
}

const unanswered: RequestFailure<never> = { _tag: "Unanswered" };

export const unavailableRequests: EnvironmentRequests = async () => {
  throw unanswered;
};

function requestFailure(cause: Cause.Cause<unknown>): RequestFailure<unknown> {
  if (Cause.hasInterruptsOnly(cause)) return { _tag: "Cancelled" };
  const error = Cause.findErrorOption(cause);
  return Option.isSome(error) &&
    !(error.value instanceof RpcClientError.RpcClientError)
    ? { _tag: "Rejected", failure: error.value }
    : unanswered;
}

function openEnvironmentRpc(
  origin: string,
  credential: EnvironmentCredential,
  disconnected: Deferred.Deferred<void>,
) {
  const url = new URL(environmentLivePath, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const protocols =
    credential.type === "bearer"
      ? [environmentSubprotocol, credential.value]
      : [environmentSubprotocol];
  const protocol = Layer.effect(RpcClient.Protocol)(
    RpcClient.makeProtocolSocket({ retryPolicy: Schedule.recurs(0) }),
  ).pipe(
    Layer.provide(
      Socket.layerWebSocket(url.href, { protocols }).pipe(
        Layer.provide(Socket.layerWebSocketConstructorGlobal),
      ),
    ),
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(
      Layer.succeed(RpcClient.ConnectionHooks)({
        onConnect: Effect.void,
        onDisconnect: Deferred.succeed(disconnected, undefined).pipe(
          Effect.asVoid,
        ),
      }),
    ),
  );
  return Layer.build(protocol).pipe(
    Effect.flatMap((context) =>
      RpcClient.make(EnvironmentRpc).pipe(Effect.provideContext(context)),
    ),
  );
}

function watchEnvironment(
  rpc: EnvironmentRpcClient,
  initialSequence: number,
  invalidation: EnvironmentInvalidation,
) {
  let sequence = initialSequence;
  return rpc.WatchEnvironment(undefined, { streamBufferSize: 1 }).pipe(
    Stream.runForEach((change) =>
      Effect.sync(() => {
        if (change.sequence <= sequence) return;
        if (change.sequence === sequence + 1)
          invalidation.changed(change.repositoryIds, change.kind);
        else invalidation.changed();
        sequence = change.sequence;
      }),
    ),
    Effect.ignore,
  );
}

function connectionFailure(
  error: ProtocolMismatch | RpcClientError.RpcClientError,
): EnvironmentConnectionFailure {
  if (error._tag === "ProtocolMismatch")
    return new EnvironmentProtocolMismatch({
      serverProtocol: error.serverProtocol,
    });
  const reason = error.reason;
  if (
    reason._tag === "SocketCloseError" &&
    reason.code === unauthorizedCloseCode
  ) {
    const failure = decodeAuthorizationFailure({ _tag: reason.closeReason });
    if (Option.isSome(failure))
      return new EnvironmentAccessDenied({ failure: failure.value });
  }
  return new EnvironmentUnavailable();
}
