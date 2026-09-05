import "#web/features/repository-history/repository-history-worker";
import { commitStoreName } from "#web/features/repository-history/repository-history-database";

const channelName = new URL(globalThis.location.href).searchParams.get(
  "channel",
);
if (channelName === null) throw new Error("Missing storage benchmark channel");
const channel = new BroadcastChannel(`history-storage-budget:${channelName}`);
const put = IDBObjectStore.prototype.put;
let armed = false;

channel.onmessage = () => {
  armed = true;
  channel.postMessage("armed");
};
IDBObjectStore.prototype.put = function (value, key) {
  if (armed && this.name === commitStoreName) {
    armed = false;
    channel.postMessage("quota-triggered");
    throw new DOMException("Injected storage pressure", "QuotaExceededError");
  }
  return put.call(this, value, key);
};
