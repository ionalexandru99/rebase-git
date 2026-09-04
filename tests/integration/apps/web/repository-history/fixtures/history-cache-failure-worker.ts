import "#web/features/repository-history/repository-history-worker";

const deleteRecords = IDBObjectStore.prototype.delete;
let failNextClear = true;

IDBObjectStore.prototype.delete = function (query) {
  if (
    failNextClear &&
    this.name === "commits" &&
    query instanceof IDBKeyRange
  ) {
    failNextClear = false;
    throw new DOMException("Injected clear failure", "InvalidStateError");
  }
  return deleteRecords.call(this, query);
};
