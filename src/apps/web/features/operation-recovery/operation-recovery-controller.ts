import type { OperationAction, OperationScope } from "@rebase/contracts";
import { Effect, Latch, type ManagedRuntime, Semaphore } from "effect";
import type {
  OperationRecoveryState,
  RepositoryOperationsClient,
} from "#web/features/operation-recovery/operation-recovery.contract";
import { createControllerScope } from "#web/platform/effect/controller-scope";
import { createStore } from "#web/platform/store/store";

const fallbackRefreshMilliseconds = 10_000;

export function createOperationRecoveryController(
  client: RepositoryOperationsClient,
  scope: OperationScope,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
) {
  const work = createControllerScope(runtime);
  const mutex = Semaphore.makeUnsafe(1);
  const stale = Latch.makeUnsafe(false);
  let generation = 0;
  let recoveryFailure: string | null = null;
  const store = createStore<OperationRecoveryState>({
    operation: null,
    connected: false,
    busy: false,
    checking: true,
    error: null,
    completed: null,
  });
  const state = store.getSnapshot;
  const publish = (next: Partial<OperationRecoveryState>) => {
    const current = state();
    if (
      work.open &&
      (Object.keys(next) as (keyof OperationRecoveryState)[]).some(
        (key) => !Object.is(current[key], next[key]),
      )
    )
      store.set({ ...current, ...next });
  };
  const read = Effect.suspend(() => {
    if (!state().connected) return Effect.void;
    const requested = generation;
    return client.read(scope).pipe(
      Effect.tap((operation) =>
        Effect.sync(() => {
          if (requested !== generation) return;
          const previous = state().operation;
          publish({
            operation:
              previous?.revision === operation.revision ? previous : operation,
            checking: false,
            completed: operation.kind === "idle" ? state().completed : null,
            error: recoveryFailure,
          });
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          if (requested === generation)
            publish({ error: error.message, checking: true });
        }),
      ),
    );
  });
  const refresh = () => work.fork(mutex.withPermit(read));
  const refreshVisible = Effect.suspend(() =>
    state().busy || document.visibilityState === "hidden"
      ? Effect.void
      : mutex.withPermit(read),
  );
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    start: () => {
      if (!work.start()) return;
      work.fork(
        Effect.forever(
          stale.close.pipe(
            Effect.andThen(refreshVisible),
            Effect.andThen(
              stale.await.pipe(
                Effect.timeoutOption(fallbackRefreshMilliseconds),
              ),
            ),
          ),
        ),
      );
    },
    stop: work.stop,
    invalidate: () => {
      stale.openUnsafe();
    },
    connect: (connected: boolean) => {
      generation++;
      publish({ connected, checking: true });
      if (connected) refresh();
    },
    checkAgain: () => {
      recoveryFailure = null;
      refresh();
    },
    dismiss: () => publish({ completed: null }),
    execute: (action: OperationAction, revision: string) => {
      const { busy, checking, connected, operation: previous } = state();
      if (
        busy ||
        checking ||
        !connected ||
        !previous?.actions.some(
          (candidate) => candidate.action === action && candidate.enabled,
        )
      )
        return;
      recoveryFailure = null;
      publish({ busy: true, error: null, completed: null });
      const requested = generation;
      work.fork(
        mutex.withPermit(
          client.execute({ ...scope, action, revision }).pipe(
            Effect.tap((operation) =>
              Effect.sync(() => {
                if (requested !== generation) return;
                publish({
                  operation,
                  completed:
                    operation.kind === "idle"
                      ? { kind: previous.kind, aborted: action === "abort" }
                      : null,
                });
              }),
            ),
            Effect.catch((error) =>
              Effect.sync(() => {
                if (requested !== generation) return;
                recoveryFailure = error.message;
                publish({ error: error.message, checking: true });
              }).pipe(Effect.andThen(read)),
            ),
            Effect.ensuring(Effect.sync(() => publish({ busy: false }))),
          ),
        ),
      );
    },
  };
}

export type OperationRecoveryController = ReturnType<
  typeof createOperationRecoveryController
>;
