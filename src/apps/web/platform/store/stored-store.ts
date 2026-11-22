import { useMemo } from "react";
import { createStore, type Store } from "#web/platform/store/store.ts";

export function createStoredStore<T>(
  key: string,
  decode: (saved: unknown) => T,
): Store<T> {
  const store = createStore(read(key, decode));
  const reload = (event: StorageEvent) => {
    if (event.key === key || event.key === null) store.set(read(key, decode));
  };
  let subscribers = 0;
  return {
    getSnapshot: store.getSnapshot,
    subscribe: (listener) => {
      if (subscribers++ === 0) window.addEventListener("storage", reload);
      const unsubscribe = store.subscribe(listener);
      return () => {
        unsubscribe();
        if (--subscribers === 0) window.removeEventListener("storage", reload);
      };
    },
    set: (next) => {
      if (Object.is(next, store.getSnapshot())) return;
      store.set(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
    },
  };
}

export function useStoredStore<T>(
  key: string,
  decode: (saved: unknown) => T,
): Store<T> {
  return useMemo(() => createStoredStore(key, decode), [key, decode]);
}

function read<T>(key: string, decode: (saved: unknown) => T) {
  try {
    return decode(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return decode(null);
  }
}
