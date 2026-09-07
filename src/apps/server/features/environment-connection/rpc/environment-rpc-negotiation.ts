import {
  type EnvironmentAccessCapability,
  type EnvironmentHello,
  type HelloAccepted,
  negotiateEnvironmentHello,
  type RepositoryHistoryOperationFailure,
} from "@rebase/contracts";
import { Deferred, Effect } from "effect";
import type { EnvironmentTransportState } from "#server/features/environment-connection/environment-connection.contract";
import type { EnvironmentRpcSession } from "#server/features/environment-connection/rpc/environment-rpc-session.contract";

export function createEnvironmentRpcSession(
  state: EnvironmentTransportState,
  access: ReadonlySet<EnvironmentAccessCapability>,
) {
  return Effect.gen(function* () {
    const accepted = yield* Deferred.make<void>();
    let negotiated: HelloAccepted | undefined;
    const session: EnvironmentRpcSession = {
      state,
      requireCapability: (name, capability) =>
        Effect.suspend(() =>
          negotiated === undefined ||
          !negotiated.capabilities.some((entry) => entry.name === name) ||
          (capability !== undefined && !access.has(capability))
            ? Effect.fail<RepositoryHistoryOperationFailure>({
                _tag: "AuthorizationDenied",
              })
            : Effect.succeed(negotiated),
        ),
    };
    return {
      ...session,
      accepted: Deferred.await(accepted),
      sendLimit: () =>
        negotiated?.limits.maxWebSocketResponseBytes ??
        state.discovery.limits.maxWebSocketResponseBytes,
      hello: (hello: EnvironmentHello) =>
        Effect.gen(function* () {
          if (negotiated !== undefined)
            return {
              _tag: "HelloRejected" as const,
              failure: { _tag: "HandshakeAlreadyCompleted" as const },
            };
          const result = negotiateEnvironmentHello(
            state.discovery,
            hello,
            state.events.currentSequence(),
          );
          if (result._tag === "HelloRejected") return result;
          negotiated = { ...result, accessCapabilities: [...access] };
          yield* Deferred.succeed(accepted, undefined);
          return negotiated;
        }),
    };
  });
}
