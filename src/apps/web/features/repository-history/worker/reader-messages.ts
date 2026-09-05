import {
  locateRepositoryHistoryCommit,
  locateRepositoryHistoryCommits,
  prepareRepositoryHistoryOrder,
  readRepositoryCommits,
} from "#web/features/repository-history/query/repository-history-query";
import { readStoredRepositoryHistoryState } from "#web/features/repository-history/replica/repository-history-store";
import {
  readCacheDiagnostics,
  scheduleCacheManagement,
} from "#web/features/repository-history/worker/cache-lifecycle";
import {
  acceptFreshness,
  requestFreshnessCommand,
  settleFreshnessCommand,
} from "#web/features/repository-history/worker/freshness-lifecycle";
import {
  acceptHistoryPage,
  readHistory,
} from "#web/features/repository-history/worker/history-pages";
import type {
  ConnectedReader,
  RepositoryReplica,
} from "#web/features/repository-history/worker/history-worker.contract";
import { closeReader } from "#web/features/repository-history/worker/reader-lifecycle";
import {
  cancelReaderSearch,
  searchHistory,
} from "#web/features/repository-history/worker/reader-search";
import {
  post,
  publishSnapshot,
} from "#web/features/repository-history/worker/replica-state";
import type { RepositoryHistoryWorkerRequest } from "#web/features/repository-history/worker/repository-history-worker.contract";
import {
  acceptHistoryBatch,
  completeSynchronization,
  failSynchronization,
  startSynchronization,
} from "#web/features/repository-history/worker/synchronization";

function rejectOversizedNavigation(
  reader: ConnectedReader,
  message: RepositoryHistoryWorkerRequest,
): boolean {
  const oversized =
    (message._tag === "GetAncestryRoute" && message.roots.length > 256) ||
    (message._tag === "LocateHistoryCommits" && message.oids.length > 1_000);
  if (!oversized) return false;
  post(reader, {
    _tag: "RequestFailed",
    requestId: message.requestId,
    failure: { _tag: "Unavailable" },
  });
  return true;
}

export async function handleReaderMessage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: RepositoryHistoryWorkerRequest,
) {
  if (reader.closed) {
    return;
  }
  if (rejectOversizedNavigation(reader, message)) return;
  await replica.initialization;
  if (reader.closed) {
    return;
  }
  switch (message._tag) {
    case "LocateHistoryCommits": {
      const positions = await locateRepositoryHistoryCommits(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
        message.query,
        message.oids,
        replica.orderCache,
      );
      post(reader, {
        _tag: "HistoryPositionsResult",
        positions,
        requestId: message.requestId,
      });
      return;
    }
    case "SearchHistory":
      searchHistory(reader, message);
      return;
    case "CancelHistorySearch":
      if (reader.search?.requestId === message.requestId)
        cancelReaderSearch(reader);
      return;
    case "GetCacheDiagnostics": {
      post(reader, {
        _tag: "CacheDiagnosticsResult",
        diagnostics: await readCacheDiagnostics(),
        requestId: message.requestId,
      });
      return;
    }
    case "GetAncestryRoute": {
      const revision = replica.orderCache.revision;
      const state = await readStoredRepositoryHistoryState(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
      );
      if (
        state?.completion !== undefined &&
        replica.orderCache.index === undefined
      )
        await prepareRepositoryHistoryOrder(
          reader.connection.environmentId,
          reader.connection.logicalRepositoryId,
          replica.orderCache,
        );
      post(reader, {
        _tag: "AncestryRouteResult",
        route:
          state?.completion !== undefined &&
          replica.orderCache.revision === revision
            ? replica.orderCache.index?.ancestryRoute(
                message.roots,
                message.oid,
              )
            : undefined,
        requestId: message.requestId,
      });
      return;
    }
    case "LocateHistoryCommit": {
      const position = await locateRepositoryHistoryCommit(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
        message.query,
        message.oid,
        replica.orderCache,
      );
      post(reader, {
        _tag: "HistoryPositionResult",
        position,
        requestId: message.requestId,
      });
      return;
    }
    case "FetchHistory":
    case "ConfigureFetch":
      requestFreshnessCommand(reader, replica, message);
      return;
    case "FreshnessChanged":
      if (replica.freshnessOwner === reader)
        await acceptFreshness(reader, replica, message.freshness);
      return;
    case "FreshnessFailed":
      if (replica.freshnessOwner === reader) {
        replica.freshnessFailure = message.failure;
        replica.revision += 1;
        publishSnapshot(replica);
      }
      return;
    case "FreshnessCommandCompleted":
    case "FreshnessCommandFailed":
      await settleFreshnessCommand(reader, replica, message);
      return;
    case "ManageCache":
      await scheduleCacheManagement(reader, replica, message.action);
      post(reader, { _tag: "CacheManaged", requestId: message.requestId });
      if (message.action === "remove") {
        for (const connected of [...replica.readers]) {
          post(connected, { _tag: "CacheRemoved" });
          await handleReaderMessage(connected, replica, {
            _tag: "CloseReader",
          });
        }
      }
      return;
    case "ReadHistory":
      await readHistory(reader, replica, message);
      return;
    case "HistoryPageReceived":
      if (!reader.epoch.isCurrent(message.requestId)) {
        return;
      }
      await acceptHistoryPage(
        reader,
        replica,
        message.requestId,
        message.bytes,
      );
      return;
    case "HistoryPageFailed":
      if (!reader.epoch.finish(message.requestId)) {
        return;
      }
      reader.queries.delete(message.requestId);
      replica.failure = message.failure;
      replica.status = "error";
      replica.revision += 1;
      publishSnapshot(replica);
      post(reader, {
        _tag: "RequestFailed",
        failure: message.failure,
        requestId: message.requestId,
      });
      return;
    case "HistoryBatchReceived":
      await acceptHistoryBatch(
        reader,
        replica,
        message.requestId,
        message.batchId,
        message.bytes,
      );
      return;
    case "HistorySynchronizationCompleted":
      await completeSynchronization(reader, replica, message);
      return;
    case "HistorySynchronizationFailed":
      await failSynchronization(reader, replica, message);
      return;
    case "GetCommitSummaries": {
      const commits = await readRepositoryCommits(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
        message.oids,
      );
      post(reader, {
        _tag: "CommitSummariesResult",
        commits,
        requestId: message.requestId,
      });
      return;
    }
    case "GetRefTargets":
      post(reader, {
        _tag: "RefTargetsResult",
        refs: replica.refTargets,
        requestId: message.requestId,
      });
      return;
    case "ReconcileHistory":
      replica.needsReconciliation = true;
      if (replica.synchronization.status !== "syncing") {
        await startSynchronization(reader, replica);
      }
      return;
    case "CloseReader":
      closeReader(reader, replica);
      return;
  }
}
