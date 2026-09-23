import type { EnvironmentRpc } from "@rebase/contracts";
import type { RpcGroup } from "effect/unstable/rpc";
import type {
  EnvironmentFeatureRpc,
  EnvironmentRpcHandlersFor,
} from "#server/adapters/environment-transport/environment-feature.contract";
import type { EnvironmentRpcSession } from "#server/adapters/environment-transport/rpc/environment-rpc-session.contract";

export function environmentFeatureRpc<
  Rpcs extends RpcGroup.Rpcs<typeof EnvironmentRpc>,
>(
  group: RpcGroup.RpcGroup<Rpcs>,
  handlers: (
    session: EnvironmentRpcSession,
  ) => EnvironmentRpcHandlersFor<RpcGroup.RpcGroup<Rpcs>>,
): EnvironmentFeatureRpc {
  return { names: [...group.requests.keys()], handlers };
}
