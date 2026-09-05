import "#web/features/repository-history/repository-history-worker";
import { queueHistoryStorageWrite } from "#web/features/repository-history/repository-history-storage-maintenance";

const control = new BroadcastChannel(
  `history-completion-${(self as unknown as { name: string }).name}`,
);
let held = false;
let release: (() => void) | undefined;
control.onmessage = () => release?.();
const worker = self as unknown as {
  onconnect: ((event: MessageEvent) => void) | null;
};
const connect = worker.onconnect;
worker.onconnect = (event) => {
  connect?.(event);
  const port = event.ports[0];
  if (port === undefined) return;
  const receive = port.onmessage;
  port.onmessage = (message) => {
    receive?.call(port, message);
    if (message.data._tag !== "ConnectRepositoryHistoryReader") return;
    const readerPort: MessagePort = message.data.port;
    const receiveReader = readerPort.onmessage;
    readerPort.onmessage = (request) => {
      if (!held && request.data._tag === "HistorySynchronizationCompleted") {
        held = true;
        void queueHistoryStorageWrite(
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
              control.postMessage("held");
            }),
        );
      }
      receiveReader?.call(readerPort, request);
      if (held && request.data._tag === "CloseReader")
        control.postMessage("closed");
    };
  };
};
