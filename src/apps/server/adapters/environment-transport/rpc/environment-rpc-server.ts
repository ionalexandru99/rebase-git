import {
  type EnvironmentAccessCapability,
  EnvironmentRpc,
  environmentRpcSerialization,
} from "@rebase/contracts";
import { Deferred, Effect, Fiber, Layer, Option } from "effect";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { Socket, SocketServer } from "effect/unstable/socket";
import type { WebSocket } from "ws";
import type { EnvironmentTransportState } from "#server/adapters/environment-transport/environment-connection.contract";
import type {
  EnvironmentFeature,
  EnvironmentRpcHandlers,
} from "#server/adapters/environment-transport/environment-feature.contract";
import { acquireEnvironmentEvents } from "#server/adapters/environment-transport/rpc/environment-rpc-events";
import { createEnvironmentRpcSession } from "#server/adapters/environment-transport/rpc/environment-rpc-negotiation";
import type { EnvironmentRpcSession } from "#server/adapters/environment-transport/rpc/environment-rpc-session.contract";
import { validateEnvironmentRpcHandlers } from "#server/adapters/environment-transport/validate-environment-features";

export function runEnvironmentRpcSession(
  socket: WebSocket,
  state: EnvironmentTransportState,
  features: readonly EnvironmentFeature[],
  address: SocketServer.Address,
  access: ReadonlySet<EnvironmentAccessCapability>,
) {
  return Effect.gen(function* () {
    const disconnected = yield* Deferred.make<void>();
    const session = yield* createEnvironmentRpcSession(state, access);
    const watchEnvironment = yield* acquireEnvironmentEvents(session);
    const handlers = EnvironmentRpc.toLayer({
      ...registeredRpcHandlers(session, features),
      Hello: session.hello,
      WatchEnvironment: watchEnvironment,
    });
    const transport = yield* Socket.fromWebSocket(
      Effect.acquireRelease(
        Effect.succeed(socket as unknown as globalThis.WebSocket),
        () => Effect.sync(() => socket.close()),
      ),
    );
    const server = Layer.succeed(SocketServer.SocketServer)({
      address,
      run: (handler) =>
        handler(transport).pipe(
          Effect.catchCause(() => Effect.sync(() => socket.close(1011))),
          Effect.ensuring(Deferred.succeed(disconnected, undefined)),
          Effect.andThen(Effect.never),
        ),
    });
    const protocol = RpcServer.layerProtocolSocketServer.pipe(
      Layer.provide(server),
      Layer.provide(
        Layer.succeed(RpcSerialization.RpcSerialization)(
          environmentRpcSerialization(
            () => state.discovery.limits.maxWebSocketRequestBytes,
            session.sendLimit,
          ),
        ),
      ),
    );
    const serving = yield* RpcServer.make(EnvironmentRpc).pipe(
      Effect.provide(handlers),
      Effect.provide(protocol),
      Effect.forkScoped,
    );
    yield* session.accepted.pipe(
      Effect.timeoutOption(state.discovery.limits.helloTimeoutMilliseconds),
      Effect.flatMap((result) =>
        Option.isNone(result)
          ? Effect.sync(() => socket.close(1008, "HandshakeRequired"))
          : Effect.void,
      ),
      Effect.forkScoped,
    );
    yield* Deferred.await(disconnected).pipe(
      Effect.raceFirst(Fiber.join(serving)),
    );
  }).pipe(
    Effect.scoped,
    Effect.catchCause(() => Effect.sync(() => socket.close(1011))),
  );
}

function registeredRpcHandlers(
  session: EnvironmentRpcSession,
  features: readonly EnvironmentFeature[],
): EnvironmentRpcHandlers {
  const handlers = unregisteredRpcHandlers();
  for (const feature of features) {
    if (feature.rpc !== undefined) {
      const registered = feature.rpc.handlers(session);
      validateEnvironmentRpcHandlers(feature.rpc.names, registered);
      Object.assign(handlers, registered);
    }
  }
  return handlers;
}

function unregisteredRpcHandlers(): EnvironmentRpcHandlers {
  return Object.fromEntries(
    [...EnvironmentRpc.requests.values()].map((rpc) => [
      rpc._tag,
      (): Effect.Effect<never> =>
        Effect.die(new Error(`No feature registered the ${rpc._tag} RPC.`)),
    ]),
  ) as Record<keyof EnvironmentRpcHandlers, () => Effect.Effect<never>>;
}
