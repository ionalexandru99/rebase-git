import type { RepositoryHistoryOperationFailure } from "@rebase/contracts";
import type { RpcClientError } from "effect/unstable/rpc";
import { environmentResponseError } from "#web/features/environment-connection/environment-connection-errors";
import { RepositoryHistoryRejected } from "#web/features/repository-history/repository-history-reader.contract";

export function historyRpcFailure(
  error: RepositoryHistoryOperationFailure | RpcClientError.RpcClientError,
) {
  return error._tag === "RpcClientError"
    ? environmentResponseError("WebSocket")
    : new RepositoryHistoryRejected({ failure: error });
}
