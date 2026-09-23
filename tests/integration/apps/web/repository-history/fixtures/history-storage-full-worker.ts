import "#web/features/repository-history/worker/repository-history-worker";
import { commitStoreName } from "#web/persistence/repository-history/repository-history-database";

const putRecord = IDBObjectStore.prototype.put;

IDBObjectStore.prototype.put = function (value, key) {
  if (this.name === commitStoreName) {
    throw new DOMException("Injected full storage", "QuotaExceededError");
  }
  return putRecord.call(this, value, key);
};
