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
    receive?.call(sharedPort, connection);
    const port: MessagePort = connection.data.port;
    port.onmessage = () => {
      throw new Error("History worker stopped processing requests");
    };
    port.start();
  };
  sharedPort.start();
};
