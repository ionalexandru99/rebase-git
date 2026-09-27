import type {
  EnvironmentCapabilityName,
  EnvironmentRpc,
} from "@rebase/contracts";
import type { Scope } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import type { EnvironmentRpcSession } from "#server/adapters/environment-transport/rpc/environment-rpc-negotiation";

export type EnvironmentRpcHandlersFor<Group extends RpcGroup.Any> = {
  readonly [Current in RpcGroup.Rpcs<Group> as Current["_tag"]]: Rpc.ToHandlerFn<
    Current,
    Scope.Scope
  >;
};

type EnvironmentFeatureRpcHandlers = Omit<
  EnvironmentRpcHandlersFor<typeof EnvironmentRpc>,
  "Hello" | "WatchEnvironment"
>;

export interface EnvironmentFeature<RpcHandlers = unknown> {
  readonly capabilities: readonly EnvironmentCapabilityName[];
  readonly httpRoutes: readonly EnvironmentHttpRouteHandler[];
  readonly rpc?: (session: EnvironmentRpcSession) => RpcHandlers;
}

export type EnvironmentFeatures = Required<
  EnvironmentFeature<EnvironmentFeatureRpcHandlers>
>;

export function combineEnvironmentFeatures<
  const Features extends readonly EnvironmentFeature[],
>(features: Features) {
  return {
    capabilities: features.flatMap((feature) => feature.capabilities),
    httpRoutes: features.flatMap((feature) => feature.httpRoutes),
    rpc: (session: EnvironmentRpcSession) =>
      Object.assign(
        {},
        ...features.map((feature) => feature.rpc?.(session)),
      ) as CombinedRpcHandlers<Features>,
  };
}

type CombinedRpcHandlers<Features extends readonly unknown[]> =
  Features extends readonly [infer First, ...infer Rest]
    ? RpcHandlersOf<First> & CombinedRpcHandlers<Rest>
    : unknown;

type RpcHandlersOf<Feature> =
  Feature extends EnvironmentFeature<infer Handlers> ? Handlers : unknown;
