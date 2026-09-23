export interface ReadableStore<T> {
  readonly getSnapshot: () => T;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface Store<T> extends ReadableStore<T> {
  readonly set: (next: T) => void;
}

export function createStore<T>(initial: T): Store<T> {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      if (Object.is(next, snapshot)) return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}
