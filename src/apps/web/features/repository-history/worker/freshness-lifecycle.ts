import type { RepositoryFreshness } from "@rebase/contracts";
import type { RepositoryHistoryWorkerRequest } from "#web/features/repository-history/repository-history-worker.contract";
import type {
  ConnectedReader,
  RepositoryReplica,
} from "#web/features/repository-history/worker/history-worker.contract";
import {
  post,
  publishSnapshot,
  workerFailure,
} from "#web/features/repository-history/worker/replica-state";
import { startSynchronization } from "#web/features/repository-history/worker/synchronization";

export function requestFreshnessCommand(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: Extract<
    RepositoryHistoryWorkerRequest,
    { _tag: "FetchHistory" | "ConfigureFetch" }
  >,
) {
  const owner = replica.freshnessOwner;
  if (owner === undefined || owner.closed || replica.freshness === undefined) {
    post(reader, {
      _tag: "RequestFailed",
      requestId: message.requestId,
      failure: { _tag: "Unavailable" },
    });
    return;
  }
  replica.freshnessCommands.set(message.requestId, reader);
  post(
    owner,
    message._tag === "FetchHistory"
      ? { _tag: "RunFetchHistory", requestId: message.requestId }
      : {
          _tag: "RunConfigureFetch",
          requestId: message.requestId,
          setting: message.setting,
        },
  );
}

export async function settleFreshnessCommand(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: Extract<
    RepositoryHistoryWorkerRequest,
    { _tag: "FreshnessCommandCompleted" | "FreshnessCommandFailed" }
  >,
) {
  if (replica.freshnessOwner !== reader) return;
  const requester = replica.freshnessCommands.get(message.requestId);
  replica.freshnessCommands.delete(message.requestId);
  if (message._tag === "FreshnessCommandCompleted") {
    await acceptFreshness(reader, replica, message.freshness);
    if (requester !== undefined)
      post(requester, {
        _tag: "FreshnessResult",
        requestId: message.requestId,
        freshness: message.freshness,
      });
  } else if (requester !== undefined) {
    post(requester, {
      _tag: "RequestFailed",
      requestId: message.requestId,
      failure: message.failure,
    });
  }
}

export function assignFreshnessOwner(replica: RepositoryReplica) {
  if (replica.freshnessOwner !== undefined) return;
  const owner = [...replica.readers].find(
    (reader) => !reader.closed && reader.connection.supportsFreshness,
  );
  if (owner === undefined) return;
  replica.freshnessOwner = owner;
  post(owner, { _tag: "SubscribeFreshness" });
}

export async function acceptFreshness(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  freshness: RepositoryFreshness,
) {
  const changed =
    replica.freshness !== undefined &&
    replica.freshness.revision !== freshness.revision;
  replica.freshness = freshness;
  delete replica.freshnessFailure;
  replica.revision += 1;
  publishSnapshot(replica);
  if (!changed) return;
  replica.needsReconciliation = true;
  if (
    replica.synchronization.status !== "syncing" &&
    (replica.status === "ready" ||
      replica.synchronization.status === "complete" ||
      replica.synchronization.status === "stale")
  )
    await startSynchronization(reader, replica).catch((error) => {
      replica.failure = workerFailure(error);
      replica.revision += 1;
      publishSnapshot(replica);
    });
}

export function closeFreshness(
  reader: ConnectedReader,
  replica: RepositoryReplica,
) {
  for (const [requestId, requester] of replica.freshnessCommands) {
    if (requester === reader || replica.freshnessOwner === reader) {
      replica.freshnessCommands.delete(requestId);
      if (requester !== reader)
        post(requester, {
          _tag: "RequestFailed",
          requestId,
          failure: { _tag: "Unavailable" },
        });
    }
  }
  if (replica.freshnessOwner === reader) {
    post(reader, { _tag: "UnsubscribeFreshness" });
    delete replica.freshnessOwner;
    assignFreshnessOwner(replica);
  }
}
