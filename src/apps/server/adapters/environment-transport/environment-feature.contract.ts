import type {
  EnvironmentCapabilityName,
  EnvironmentRpc,
} from "@rebase/contracts";
import type { Scope } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import type { EnvironmentRpcSession } from "#server/adapters/environment-transport/rpc/environment-rpc-session.contract";

export type EnvironmentRpcHandlersFor<Group extends RpcGroup.Any> = {
  readonly [Current in RpcGroup.Rpcs<Group> as Current["_tag"]]: Rpc.ToHandlerFn<
    Current,
    Scope.Scope
  >;
};

export type EnvironmentRpcHandlers = EnvironmentRpcHandlersFor<
  typeof EnvironmentRpc
>;

export interface EnvironmentFeatureRpc {
  readonly names: readonly string[];
  readonly handlers: (
    session: EnvironmentRpcSession,
  ) => Partial<EnvironmentRpcHandlers>;
}

export interface EnvironmentFeature {
  readonly capabilities: readonly EnvironmentCapabilityName[];
  readonly httpRoutes: readonly EnvironmentHttpRouteHandler[];
  readonly rpc?: EnvironmentFeatureRpc;
}
