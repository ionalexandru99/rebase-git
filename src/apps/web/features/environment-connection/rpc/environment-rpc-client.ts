import {
  type EnvironmentDiscovery,
  type EnvironmentHello,
  EnvironmentHelloResult,
  negotiateEnvironmentHello,
} from "@rebase/contracts";
import {
  EnvironmentRpc,
  type EnvironmentRpcClient,
} from "@rebase/contracts/environment-connection/rpc/environment-rpc.contract";
import { environmentRpcSerialization } from "@rebase/contracts/environment-connection/rpc/environment-rpc-serialization";
import { Deferred, Effect, Layer, Schedule, Schema } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import {
  EnvironmentHelloRejected,
  environmentResponseError,
} from "#web/features/environment-connection/environment-connection-errors";

const equivalentHello = Schema.toEquivalence(EnvironmentHelloResult);

export function acquireEnvironmentRpc(
  url: URL,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
) {
  return Effect.gen(function* () {
    const disconnected = yield* Deferred.make<void>();
    const protocol = Layer.effect(RpcClient.Protocol)(
      RpcClient.makeProtocolSocket({ retryPolicy: Schedule.recurs(0) }),
    ).pipe(
      Layer.provide(
        Socket.layerWebSocket(url.href).pipe(
          Layer.provide(Socket.layerWebSocketConstructorGlobal),
        ),
      ),
      Layer.provide(
        Layer.succeed(RpcSerialization.RpcSerialization)(
          environmentRpcSerialization(
            () =>
              Math.min(
                hello.receiveLimits.maxWebSocketResponseBytes,
                discovery.limits.maxWebSocketResponseBytes,
              ),
            () => discovery.limits.maxWebSocketRequestBytes,
          ),
        ),
      ),
      Layer.provide(
        Layer.succeed(RpcClient.ConnectionHooks)({
          onConnect: Effect.void,
          onDisconnect: Deferred.succeed(disconnected, undefined).pipe(
            Effect.asVoid,
          ),
        }),
      ),
    );
    const context = yield* Layer.build(protocol);
    const client = yield* RpcClient.make(EnvironmentRpc).pipe(
      Effect.provideContext(context),
    );
    return { client, disconnected: Deferred.await(disconnected) };
  });
}

export function negotiateEnvironmentRpc(
  client: EnvironmentRpcClient,
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
) {
  return Effect.gen(function* () {
    const result = yield* client.Hello(hello).pipe(
      Effect.timeout(discovery.limits.helloTimeoutMilliseconds),
      Effect.mapError(() => environmentResponseError("WebSocket")),
    );
    if (result._tag === "HelloRejected")
      return yield* new EnvironmentHelloRejected({ failure: result.failure });
    const expected = negotiateEnvironmentHello(
      discovery,
      hello,
      result.currentSequence,
    );
    const { accessCapabilities: _access, ...negotiated } = result;
    if (!equivalentHello(expected, negotiated))
      return yield* environmentResponseError("WebSocket");
    return result;
  });
}
