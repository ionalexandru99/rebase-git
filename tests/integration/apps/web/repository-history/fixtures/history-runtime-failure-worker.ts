import "#web/features/repository-history/repository-history-worker";

const worker = self as unknown as {
  onconnect: ((event: MessageEvent) => void) | null;
};

const connect = worker.onconnect;
worker.onconnect = (event) => {
  connect?.(event);
  const sharedPort = event.ports[0];
  if (sharedPort === undefined) return;
  const receive = sharedPort.onmessage;
  sharedPort.onmessage = (connection) => {
    if (connection.data === "fail") {
      throw new Error("History worker stopped processing requests");
    }
    receive?.call(sharedPort, connection);
  };
  sharedPort.start();
};
