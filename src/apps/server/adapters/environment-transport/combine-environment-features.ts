import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import type { EnvironmentRpcSession } from "#server/adapters/environment-transport/rpc/environment-rpc-session.contract";

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
