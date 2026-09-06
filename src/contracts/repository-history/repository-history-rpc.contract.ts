import { JsonMessageFragment } from "@rebase/contracts/environment-connection/websocket/json-message-fragment.contract";
import {
  RepositoryFetchSetting,
  RepositoryFreshness,
} from "@rebase/contracts/repository-history/repository-freshness.contract";
import {
  AcknowledgeRepositoryHistoryBatch,
  ReadRepositoryHistory,
  RepositoryHistoryOperationFailure,
  RepositoryHistorySynchronized,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts/repository-history/repository-history.contract";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

const RepositoryId = ReadRepositoryHistory.fields.repositoryId;
export const RepositoryHistoryRpc = RpcGroup.make(
  Rpc.make("ReadHistory", {
    payload: ReadRepositoryHistory,
    success: JsonMessageFragment,
    error: RepositoryHistoryOperationFailure,
    stream: true,
  }),
  Rpc.make("SynchronizeHistory", {
    payload: SynchronizeRepositoryHistory,
    success: Schema.Union([JsonMessageFragment, RepositoryHistorySynchronized]),
    error: RepositoryHistoryOperationFailure,
    stream: true,
  }),
  Rpc.make("CommitHistoryBatch", {
    payload: AcknowledgeRepositoryHistoryBatch,
    error: RepositoryHistoryOperationFailure,
  }),
  Rpc.make("WatchFreshness", {
    payload: { repositoryId: RepositoryId },
    success: RepositoryFreshness,
    error: RepositoryHistoryOperationFailure,
    stream: true,
  }),
  Rpc.make("FetchHistory", {
    payload: { repositoryId: RepositoryId },
    success: RepositoryFreshness,
    error: RepositoryHistoryOperationFailure,
  }),
  Rpc.make("ConfigureFetch", {
    payload: { repositoryId: RepositoryId, setting: RepositoryFetchSetting },
    success: RepositoryFreshness,
    error: RepositoryHistoryOperationFailure,
  }),
);
