import type {
  ConnectRepositoryHistoryReader,
  RepositoryHistoryWorkerRequest,
  RepositoryHistoryWorkerResponse,
} from "#web/features/repository-history/worker/repository-history-worker.contract";

const worker = self as unknown as {
  onconnect: ((event: MessageEvent) => void) | null;
};

worker.onconnect = (event) => {
  const sharedPort = event.ports[0];
  if (sharedPort === undefined) {
    return;
  }
  sharedPort.onmessage = (
    connection: MessageEvent<ConnectRepositoryHistoryReader>,
  ) => {
    const port = connection.data.port;
    port.onmessage = (event: MessageEvent<RepositoryHistoryWorkerRequest>) => {
      const request = event.data;
      if (
        request._tag === "GetRefTargets" ||
        request._tag === "LocateHistoryCommit"
      ) {
        port.postMessage({
          _tag: "HistoryPositionResult",
          requestId: request.requestId,
          position: 7,
        } satisfies RepositoryHistoryWorkerResponse);
      } else if (request._tag === "CloseReader") {
        port.close();
      }
    };
    port.start();
  };
  sharedPort.start();
};
