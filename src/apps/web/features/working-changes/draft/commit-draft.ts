import { Effect, type Fiber, type ManagedRuntime, Semaphore } from "effect";
import { saveCommitDraft } from "#web/persistence/working-changes/working-changes-store";
import {
  type CommitDraft,
  emptyCommitDraft,
  type WorkingChangesStoreUnavailable,
} from "#web/persistence/working-changes/working-changes-store.contract";
import type { ControllerScope } from "#web/platform/effect/controller-scope";
import { createStore } from "#web/platform/store/store";

const saveDelayMilliseconds = 300;

export function createCommitDraft(
  work: ControllerScope,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
  onFailure: (error: WorkingChangesStoreUnavailable) => Effect.Effect<void>,
) {
  const store = createStore<CommitDraft>(emptyCommitDraft);
  const writes = Semaphore.makeUnsafe(1);
  let pending:
    | { readonly key: string; readonly draft: CommitDraft }
    | undefined;
  let waiting: Fiber.Fiber<unknown> | undefined;
  const save = (key: string, draft: CommitDraft) =>
    writes
      .withPermit(saveCommitDraft(key, draft))
      .pipe(Effect.catch(onFailure));
  const savePending = Effect.suspend(() => {
    const next = pending;
    pending = undefined;
    return next === undefined ? Effect.void : save(next.key, next.draft);
  });
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    show: store.set,
    edit: (key: string, draft: CommitDraft) => {
      store.set(draft);
      if (pending !== undefined && pending.key !== key)
        work.fork(save(pending.key, pending.draft));
      pending = { key, draft };
      work.interrupt(waiting);
      waiting = work.fork(
        Effect.sleep(saveDelayMilliseconds).pipe(
          Effect.andThen(Effect.uninterruptible(savePending)),
        ),
      );
    },
    clear: (keys: readonly string[]) =>
      Effect.suspend(() => {
        pending = undefined;
        store.set(emptyCommitDraft);
        return Effect.forEach(keys, (key) => save(key, emptyCommitDraft), {
          discard: true,
        });
      }),
    flush: () => {
      if (pending !== undefined) runtime.runFork(savePending);
    },
  };
}
