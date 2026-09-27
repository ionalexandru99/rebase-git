import {
  type AuthorizationDenied,
  type EnvironmentCapabilityName,
  type EnvironmentHello,
  type HelloAccepted,
  negotiateEnvironmentHello,
} from "@rebase/contracts";
import { Deferred, Effect } from "effect";
import type { EnvironmentTransportState } from "#server/adapters/environment-transport/environment-transport-discovery";

export interface EnvironmentRpcSession {
  readonly state: EnvironmentTransportState;
  readonly requireCapability: (
    name: EnvironmentCapabilityName,
  ) => Effect.Effect<HelloAccepted, AuthorizationDenied>;
}

export function createEnvironmentRpcSession(state: EnvironmentTransportState) {
  return Effect.gen(function* () {
    const accepted = yield* Deferred.make<void>();
    let negotiated: HelloAccepted | undefined;
    const session: EnvironmentRpcSession = {
      state,
      requireCapability: (name) =>
        Effect.suspend(() =>
          negotiated === undefined ||
          !negotiated.capabilities.some((entry) => entry.name === name)
            ? Effect.fail<AuthorizationDenied>({ _tag: "AuthorizationDenied" })
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
          negotiated = result;
          yield* Deferred.succeed(accepted, undefined);
          return negotiated;
        }),
    };
  });
}
