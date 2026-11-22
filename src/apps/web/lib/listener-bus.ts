import { useEffect, useEffectEvent } from "react";

export interface ListenerBus<Value> {
  readonly emit: (value: Value) => boolean;
  readonly listen: (listener: (value: Value) => void) => () => void;
}

export function listenerBus<Value>(): ListenerBus<Value> {
  const listeners = new Set<(value: Value) => void>();
  return {
    emit: (value) => {
      for (const listener of listeners) listener(value);
      return listeners.size > 0;
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useListener<Value>(
  bus: ListenerBus<Value>,
  handle: (value: Value) => void,
) {
  const listener = useEffectEvent(handle);
  useEffect(() => bus.listen(listener), [bus]);
}
