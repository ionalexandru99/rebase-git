import type {
  ConnectRepositoryHistoryReader,
  RepositoryHistoryWorkerResponse,
} from "#web/features/repository-history/repository-history-worker.contract";
import { clearingAllCaches } from "#web/features/repository-history/worker/cache-lifecycle";
import {
  closeReader,
  connectReader,
} from "#web/features/repository-history/worker/reader-lifecycle";
import { handleReaderMessage } from "#web/features/repository-history/worker/reader-messages";
import { post } from "#web/features/repository-history/worker/replica-state";
import { repositories } from "#web/features/repository-history/worker/repository-replicas";

const pendingConnections = new Set<ConnectRepositoryHistoryReader>();
let failed = false;

function failWorker() {
  if (failed) return;
  failed = true;
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
    message: MessageEvent<ConnectRepositoryHistoryReader>,
  ) => {
    if (message.data._tag !== "ConnectRepositoryHistoryReader") return;
    pendingConnections.add(message.data);
    if (clearingAllCaches === undefined) registerPendingReader(message.data);
    else
      void clearingAllCaches.then((cleared) =>
        registerPendingReader(message.data, cleared),
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
