import { EnvironmentRpcFailure } from "@rebase/contracts/environment-connection/rpc/environment-rpc-failure.contract";
import {
  EnvironmentChanged,
  EnvironmentHello,
  EnvironmentHelloResult,
} from "@rebase/contracts/environment-connection/websocket/environment-live-connection.contract";
import { RepositoryHistoryRpc } from "@rebase/contracts/repository-history/repository-history-rpc.contract";
import { RepositoryRefsRpc } from "@rebase/contracts/repository-refs/repository-refs-rpc.contract";
import {
  Rpc,
  type RpcClient,
  type RpcClientError,
  RpcGroup,
} from "effect/unstable/rpc";

export const EnvironmentRpc = RpcGroup.make(
  Rpc.make("Hello", {
    payload: EnvironmentHello,
    success: EnvironmentHelloResult,
  }),
  Rpc.make("WatchEnvironment", {
    success: EnvironmentChanged,
    error: EnvironmentRpcFailure,
    stream: true,
  }),
).merge(RepositoryHistoryRpc, RepositoryRefsRpc);

export type EnvironmentRpcClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof EnvironmentRpc>,
  RpcClientError.RpcClientError
>;
