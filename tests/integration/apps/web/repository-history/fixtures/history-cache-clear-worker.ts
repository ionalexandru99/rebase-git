import "#web/features/repository-history/repository-history-worker";
import {
  commitStoreName,
  repositoryStoreName,
} from "#web/features/repository-history/repository-history-database";

const control = new BroadcastChannel(
  `history-clear-${(self as unknown as { name: string }).name}`,
);
const getAll = IDBObjectStore.prototype.getAll;
const deleteRecords = IDBObjectStore.prototype.delete;
let held = false;
let failClear = false;

const sharedWorker = self as unknown as {
  onconnect: ((event: MessageEvent) => void) | null;
};
const connect = sharedWorker.onconnect;
sharedWorker.onconnect = (event) => {
  connect?.(event);
  const port = event.ports[0];
  if (port === undefined) return;
  const receive = port.onmessage;
  port.onmessage = (message) => {
    receive?.call(port, message);
    if (held && message.data._tag === "ConnectRepositoryHistoryReader")
      control.postMessage("connecting");
  };
};

IDBObjectStore.prototype.getAll = function (...args) {
  const request = getAll.apply(this, args);
  if (!held && this.name === repositoryStoreName) {
    held = true;
    let accept: typeof request.onsuccess = null;
    Object.defineProperty(request, "onsuccess", {
      set(value) {
        accept = value;
      },
    });
    request.addEventListener("success", (event) => {
      control.postMessage("waiting");
      control.onmessage = (message) => {
        if (message.data === "crash") {
          void Promise.reject(
            new Error("History worker failed during cache clear"),
          );
          control.close();
          return;
        }
        failClear = message.data === "fail";
        accept?.call(request, event);
        control.close();
      };
    });
  }
  return request;
};

IDBObjectStore.prototype.delete = function (query) {
  if (
    failClear &&
    this.name === commitStoreName &&
    query instanceof IDBKeyRange
  ) {
    failClear = false;
    throw new DOMException("Injected clear failure", "InvalidStateError");
  }
  return deleteRecords.call(this, query);
};
