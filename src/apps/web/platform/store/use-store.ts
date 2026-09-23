import { useMemo, useSyncExternalStore } from "react";
import type { ReadableStore } from "#web/platform/store/store";

export function useStore<T>(store: ReadableStore<T>): T;
export function useStore<T, Selected>(
  store: ReadableStore<T>,
  select: (snapshot: T) => Selected,
): Selected;
export function useStore<T, Selected>(
  store: ReadableStore<T>,
  select?: (snapshot: T) => Selected,
): T | Selected {
  const getSelection = useMemo<() => T | Selected>(
    () => (select === undefined ? store.getSnapshot : memoize(store, select)),
    [store, select],
  );
  return useSyncExternalStore<T | Selected>(
    store.subscribe,
    getSelection,
    getSelection,
  );
}

function memoize<T, Selected>(
  store: ReadableStore<T>,
  select: (snapshot: T) => Selected,
) {
  let cached: { snapshot: T; selection: Selected } | undefined;
  return () => {
    const snapshot = store.getSnapshot();
    if (cached === undefined || !Object.is(cached.snapshot, snapshot))
      cached = { snapshot, selection: select(snapshot) };
    return cached.selection;
  };
}
