import type { EnvironmentAccessCapability } from "@rebase/contracts";
import { EnvironmentRpc } from "@rebase/contracts/environment-connection/rpc/environment-rpc.contract";
import { environmentRpcSerialization } from "@rebase/contracts/environment-connection/rpc/environment-rpc-serialization";
import { Deferred, Effect, Fiber, Layer, Option } from "effect";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { Socket, SocketServer } from "effect/unstable/socket";
import type { WebSocket } from "ws";
import type { EnvironmentTransportState } from "#server/features/environment-connection/environment-connection.contract";
import { acquireEnvironmentEvents } from "#server/features/environment-connection/rpc/environment-rpc-events";
import { createEnvironmentRpcSession } from "#server/features/environment-connection/rpc/environment-rpc-negotiation";
import { repositoryFreshnessRpc } from "#server/features/environment-connection/rpc/repository-freshness-rpc";
import { repositoryHistoryRpc } from "#server/features/environment-connection/rpc/repository-history-rpc";
import { repositoryRefsRpc } from "#server/features/repository-refs/rpc/repository-refs-rpc";

export function runEnvironmentRpcSession(
  socket: WebSocket,
  state: EnvironmentTransportState,
  address: SocketServer.Address,
  access: ReadonlySet<EnvironmentAccessCapability>,
) {
  return Effect.gen(function* () {
    const disconnected = yield* Deferred.make<void>();
    const session = yield* createEnvironmentRpcSession(state, access);
    const watchEnvironment = yield* acquireEnvironmentEvents(session);
    const handlers = EnvironmentRpc.toLayer({
      ReadRefs: repositoryRefsRpc(session),
      Hello: session.hello,
      WatchEnvironment: watchEnvironment,
      ...repositoryHistoryRpc(session),
      ...repositoryFreshnessRpc(session),
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
