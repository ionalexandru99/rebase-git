import { JsonMessageFragment } from "@rebase/contracts/environment-connection/websocket/json-message-fragment.contract";
import {
  ReadRepositoryRefsMessage,
  RepositoryRefsFailed,
} from "@rebase/contracts/repository-refs/repository-refs-sync.contract";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
export const RepositoryRefsRpc = RpcGroup.make(
  Rpc.make("ReadRefs", {
    payload: ReadRepositoryRefsMessage,
    success: JsonMessageFragment,
    error: RepositoryRefsFailed.fields.failure,
    stream: true,
  }),
);
