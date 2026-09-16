import type {
  OperationAction,
  OperationFailure,
  OperationScope,
} from "@rebase/contracts/repository-operations/repository-operations.contract";
import { Effect, Layer, ManagedRuntime, Semaphore } from "effect";
import type {
  OperationRecoveryState,
  RepositoryOperationsClient,
} from "#web/features/operation-recovery/operation-recovery.contract";

export function createOperationRecoveryController(
  client: RepositoryOperationsClient,
  scope: OperationScope,
  invalidate: () => void,
) {
  const runtime = ManagedRuntime.make(Layer.empty);
  const mutex = Semaphore.makeUnsafe(1);
  const listeners = new Set<() => void>();
  let owners = 0;
  let started = false;
  let disposed = false;
  let generation = 0;
  let recoveryFailure: OperationFailure | null = null;
  let state: OperationRecoveryState = {
    operation: null,
    connected: false,
    busy: false,
    checking: true,
    error: null,
    completed: null,
  };
  const publish = (patch: Partial<OperationRecoveryState>) => {
    if (disposed) return;
    if (
      !(Object.keys(patch) as (keyof OperationRecoveryState)[]).some(
        (key) => !Object.is(state[key], patch[key]),
      )
    )
      return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const refresh = Effect.suspend(() => {
    if (!state.connected) return Effect.void;
    const requestGeneration = generation;
    return client.read(scope).pipe(
      Effect.tap((operation) =>
        Effect.sync(() => {
          if (requestGeneration !== generation) return;
          const previous = state.operation;
          if (previous && previous.revision !== operation.revision)
            invalidate();
          publish({
            operation:
              previous?.revision === operation.revision ? previous : operation,
            checking: false,
            completed: operation.kind === "idle" ? state.completed : null,
            error: recoveryFailure,
          });
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          if (requestGeneration === generation)
            publish({ error: error.failure, checking: true });
        }),
      ),
    );
  });
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      owners++;
      if (started) return;
      started = true;
      runtime.runFork(
        Effect.forever(
          Effect.sleep(2500).pipe(
            Effect.andThen(
              Effect.suspend(() =>
                state.busy || document.visibilityState === "hidden"
                  ? Effect.void
                  : mutex.withPermit(refresh),
              ),
            ),
          ),
        ),
      );
    },
    stop: () => {
      owners--;
      queueMicrotask(() => {
        if (owners === 0) {
          disposed = true;
          void runtime.dispose();
        }
      });
    },
    connect: (connected: boolean) => {
      generation++;
      publish({ connected, checking: true });
      if (connected) runtime.runFork(mutex.withPermit(refresh));
    },
    refresh: () => runtime.runFork(mutex.withPermit(refresh)),
    checkAgain: () => {
      recoveryFailure = null;
      runtime.runFork(mutex.withPermit(refresh));
    },
    dismiss: () => publish({ completed: null }),
    execute: (action: OperationAction, revision: string) => {
      const previous = state.operation;
      if (
        state.busy ||
        state.checking ||
        !state.connected ||
        !previous?.actions.some(
          (candidate) => candidate.action === action && candidate.enabled,
        )
      )
        return;
      recoveryFailure = null;
      publish({ busy: true, error: null, completed: null });
      const requestGeneration = generation;
      runtime.runFork(
        mutex.withPermit(
          client.execute({ ...scope, action, revision }).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                invalidate();
                if (requestGeneration !== generation) return;
                publish({
                  operation: result.operation,
                  completed:
                    result.operation.kind === "idle"
                      ? { kind: previous.kind, aborted: action === "abort" }
                      : null,
                });
              }),
            ),
            Effect.catch((error) =>
              Effect.sync(() => {
                invalidate();
                if (requestGeneration !== generation) return;
                recoveryFailure = error.failure;
                publish({ error: error.failure, checking: true });
              }).pipe(Effect.andThen(refresh)),
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
