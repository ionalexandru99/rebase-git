import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";
import { RepositoryHistoryOffline } from "#web/features/repository-history/repository-history-reader.contract";

export function maintainRepositoryHistoryReader(
  create: () => RepositoryHistoryReader,
): RepositoryHistoryReader {
  const listeners = new Set<() => void>();
  let reader: RepositoryHistoryReader | undefined = create();
  let snapshot = reader.getSnapshot();
  let unsubscribe = reader.subscribe(publish);
  let lastQuery: RepositoryHistoryQuery | undefined;
  let closed = false;

  function publish() {
    if (reader !== undefined) snapshot = reader.getSnapshot();
    for (const listener of listeners) listener();
  }

  function suspend() {
    unsubscribe();
    reader?.close();
    reader = undefined;
  }

  function resume() {
    if (closed || reader !== undefined) return;
    reader = create();
    unsubscribe = reader.subscribe(publish);
    publish();
    if (lastQuery !== undefined)
      void reader.read(lastQuery).catch(() => undefined);
  }

  globalThis.addEventListener("pagehide", suspend);
  globalThis.addEventListener("pageshow", resume);

  return {
    ancestryRoute: (roots, oid) =>
      reader?.ancestryRoute(roots, oid) ??
      Promise.reject(new RepositoryHistoryOffline()),
    locate: (query, oid) =>
      reader?.locate(query, oid) ??
      Promise.reject(new RepositoryHistoryOffline()),
    locateMany: (query, oids) =>
      reader?.locateMany(query, oids) ??
      Promise.reject(new RepositoryHistoryOffline()),
    close: () => {
      if (closed) return;
      closed = true;
      globalThis.removeEventListener("pagehide", suspend);
      globalThis.removeEventListener("pageshow", resume);
      suspend();
      listeners.clear();
    },
    getCommitSummaries: (oids) =>
      reader?.getCommitSummaries(oids) ??
      Promise.reject(new RepositoryHistoryOffline()),
    getCacheDiagnostics: () =>
      reader?.getCacheDiagnostics() ??
      Promise.reject(new RepositoryHistoryOffline()),
    manageCache: (action) =>
      reader?.manageCache(action) ??
      Promise.reject(new RepositoryHistoryOffline()),
    getRefTargets: () =>
      reader?.getRefTargets() ?? Promise.reject(new RepositoryHistoryOffline()),
    getSnapshot: () => snapshot,
    read: (query) => {
      lastQuery = query;
      return (
        reader?.read(query) ?? Promise.reject(new RepositoryHistoryOffline())
      );
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
