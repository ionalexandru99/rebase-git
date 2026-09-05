import type { HistoryStorageRequest } from "#web/features/repository-history/diagnostics/history-storage.contract";
import { clearingAllCaches } from "#web/features/repository-history/worker/cache-lifecycle";
import {
  failHistoryStorageRequests,
  handleHistoryStorageRequest,
} from "#web/features/repository-history/worker/history-storage-messages";
import {
  closeReader,
  connectReader,
} from "#web/features/repository-history/worker/reader-lifecycle";
import { handleReaderMessage } from "#web/features/repository-history/worker/reader-messages";
import { post } from "#web/features/repository-history/worker/replica-state";
import type {
  ConnectRepositoryHistoryReader,
  RepositoryHistoryWorkerResponse,
} from "#web/features/repository-history/worker/repository-history-worker.contract";
import { repositories } from "#web/features/repository-history/worker/repository-replicas";

const pendingConnections = new Set<ConnectRepositoryHistoryReader>();
let failed = false;

function failWorker() {
  if (failed) return;
  failed = true;
  failHistoryStorageRequests();
  for (const connection of pendingConnections) {
    connection.port.postMessage({
      _tag: "WorkerFailed",
    } satisfies RepositoryHistoryWorkerResponse);
    connection.port.close();
  }
  pendingConnections.clear();
  for (const replica of repositories.values()) {
    replica.cachePaused = true;
    for (const reader of [...replica.readers]) {
      post(reader, { _tag: "WorkerFailed" });
      closeReader(reader, replica);
    }
  }
  globalThis.close();
}

globalThis.addEventListener("error", failWorker);
globalThis.addEventListener("unhandledrejection", failWorker);
const worker = self as unknown as {
  onconnect: ((event: MessageEvent) => void) | null;
};

worker.onconnect = (event) => {
  const sharedPort = event.ports[0];
  if (sharedPort === undefined) return;
  sharedPort.onmessage = (
    message: MessageEvent<
      ConnectRepositoryHistoryReader | HistoryStorageRequest
    >,
  ) => {
    if (message.data._tag === "HistoryStorageRequest") {
      void handleHistoryStorageRequest(message.data);
      return;
    }
    if (message.data._tag !== "ConnectRepositoryHistoryReader") return;
    const connection = message.data;
    pendingConnections.add(connection);
    if (clearingAllCaches === undefined) registerPendingReader(connection);
    else
      void clearingAllCaches.then((cleared) =>
        registerPendingReader(connection, cleared),
      );
  };
  sharedPort.start();
};

function registerPendingReader(
  connection: ConnectRepositoryHistoryReader,
  cachePaused = false,
) {
  if (failed) return;
  connectReader(connection, handleReaderMessage, cachePaused);
  pendingConnections.delete(connection);
}
