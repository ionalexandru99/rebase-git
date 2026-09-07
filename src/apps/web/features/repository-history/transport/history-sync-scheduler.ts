import { Deferred, Effect } from "effect";

interface WaitingSynchronization {
  readonly priority: "background" | "visible";
  readonly ready: Deferred.Deferred<void>;
}

export function createHistorySyncScheduler() {
  const waiting: WaitingSynchronization[] = [];
  let active: WaitingSynchronization | undefined;
  const startNext = () => {
    if (active !== undefined) return;
    const visible = waiting.findIndex((entry) => entry.priority === "visible");
    active = waiting.splice(visible < 0 ? 0 : visible, 1)[0];
    if (active !== undefined) Deferred.doneUnsafe(active.ready, Effect.void);
  };
  return <A, E, R>(
    priority: WaitingSynchronization["priority"],
    operation: Effect.Effect<A, E, R>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const entry = { priority, ready };
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            waiting.push(entry);
            startNext();
          }),
          () =>
            Effect.sync(() => {
              if (active === entry) active = undefined;
              const index = waiting.indexOf(entry);
              if (index >= 0) waiting.splice(index, 1);
              startNext();
            }),
        );
        yield* Deferred.await(ready);
        return yield* operation;
      }),
    );
}
