import { type Effect, Layer, ManagedRuntime } from "effect";

export function createApplicationRuntime() {
  const runtime = ManagedRuntime.make(Layer.empty);
  let owners = 0;
  let started = false;
  let disposed = false;
  return {
    get disposed() {
      return disposed;
    },
    runFork: runtime.runFork,
    start: (effect: Effect.Effect<unknown>) => {
      owners++;
      if (started) return;
      started = true;
      runtime.runFork(effect);
    },
    stop: () => {
      owners--;
      queueMicrotask(() => {
        if (owners === 0 && !disposed) {
          disposed = true;
          void runtime.dispose();
        }
      });
    },
  };
}
