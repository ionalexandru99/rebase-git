import type {
  EnvironmentCapabilityName,
  EnvironmentRpc,
} from "@rebase/contracts";
import type { Scope } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import type { EnvironmentRpcSession } from "#server/adapters/environment-transport/rpc/environment-rpc-session.contract";

type EnvironmentRpcs = RpcGroup.Rpcs<typeof EnvironmentRpc>;

export type EnvironmentRpcHandlers = {
  readonly [Current in EnvironmentRpcs as Current["_tag"]]: Rpc.ToHandlerFn<
    Current,
    Scope.Scope
  >;
};

export interface EnvironmentFeature {
  readonly capabilities: readonly EnvironmentCapabilityName[];
  readonly httpRoutes: readonly EnvironmentHttpRouteHandler[];
  readonly rpcHandlers: (
    session: EnvironmentRpcSession,
  ) => Partial<EnvironmentRpcHandlers>;
}
