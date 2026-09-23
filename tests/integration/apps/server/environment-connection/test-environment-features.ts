import { EnvironmentRpc } from "@rebase/contracts";
import { Effect } from "effect";
import { combineEnvironmentFeatures } from "#server/adapters/environment-transport/combine-environment-features";
import type {
  EnvironmentFeature,
  EnvironmentFeatureRpcHandlers,
} from "#server/adapters/environment-transport/environment-feature.contract";

const unregisteredRpc: EnvironmentFeature<EnvironmentFeatureRpcHandlers> = {
  capabilities: [],
  httpRoutes: [],
  rpc: () =>
    Object.fromEntries(
      [...EnvironmentRpc.requests.keys()].map((tag) => [
        tag,
        () => Effect.die(new Error(`No test feature registered ${tag}.`)),
      ]),
    ) as unknown as EnvironmentFeatureRpcHandlers,
};

export function testEnvironmentFeatures(
  features: readonly EnvironmentFeature[],
) {
  return combineEnvironmentFeatures([unregisteredRpc, ...features]);
}
