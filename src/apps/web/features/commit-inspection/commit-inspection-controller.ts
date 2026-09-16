import type { InspectCommit } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import { Effect, Fiber, Layer, ManagedRuntime } from "effect";
import type {
  CommitInspectionClient,
  CommitInspectionState,
} from "#web/features/commit-inspection/commit-inspection.contract";
import {
  type DiffPreferences,
  defaultDiffPreferences,
} from "#web/features/file-diff/file-diff.contract";
import {
  readDiffPreferences,
  saveDiffPreferences,
} from "#web/persistence/working-changes/working-changes-store";

export function createCommitInspectionController(
  client: CommitInspectionClient,
  scope: Pick<InspectCommit, "repositoryId" | "worktreePath">,
) {
  const runtime = ManagedRuntime.make(Layer.empty);
  let state: CommitInspectionState = {
    oid: undefined,
    details: null,
    path: null,
    diff: null,
    loading: false,
    loadingDiff: false,
    error: null,
    diffError: null,
    preferences: defaultDiffPreferences,
  };
  const listeners = new Set<() => void>();
  let detailsFiber: Fiber.Fiber<void> | undefined;
  let diffFiber: Fiber.Fiber<void> | undefined;
  let generation = 0;
  let fileGeneration = 0;
  let disposed = false;
  let owners = 0;
  let parentOid: string | undefined;
  const publish = (next: Partial<CommitInspectionState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const cancel = (fiber: Fiber.Fiber<void> | undefined) => {
    if (fiber !== undefined) runtime.runFork(Fiber.interrupt(fiber));
  };
  const selectFile = (path: string | null) => {
    if (
      path === state.path &&
      state.diffError === null &&
      (state.diff !== null || state.loadingDiff)
    )
      return;
    const current = ++fileGeneration;
    cancel(diffFiber);
    publish({ path, diff: null, diffError: null, loadingDiff: path !== null });
    const details = state.details;
    if (path === null || details === null) return;
    diffFiber = runtime.runFork(
      client
        .diff({
          ...scope,
          oid: details.oid,
          ...(details.parentOid === null
            ? {}
            : { parentOid: details.parentOid }),
          path,
        })
        .pipe(
          Effect.match({
            onSuccess: (diff) => {
              if (current === fileGeneration)
                publish({ diff, loadingDiff: false });
            },
            onFailure: (error) => {
              if (current === fileGeneration)
                publish({ diffError: error.message, loadingDiff: false });
            },
          }),
        ),
    );
  };
  const load = (oid: string | undefined, parent?: string) => {
    const current = ++generation;
    ++fileGeneration;
    cancel(detailsFiber);
    cancel(diffFiber);
    parentOid = parent;
    const previousPath = state.oid === oid ? state.path : null;
    const details =
      state.details !== null &&
      state.details.oid === oid &&
      parent !== undefined
        ? { ...state.details, parentOid: parent, files: [] }
        : null;
    publish({
      oid,
      details,
      path: previousPath,
      diff: null,
      loading: oid !== undefined,
      loadingDiff: false,
      error: null,
      diffError: null,
    });
    if (oid === undefined) return;
    detailsFiber = runtime.runFork(
      client
        .inspect({
          ...scope,
          oid,
          ...(parent === undefined ? {} : { parentOid: parent }),
        })
        .pipe(
          Effect.match({
            onSuccess: (details) => {
              if (current !== generation) return;
              publish({ details, loading: false });
              selectFile(
                details.files.find((file) => file.path === previousPath)
                  ?.path ??
                  details.files[0]?.path ??
                  null,
              );
            },
            onFailure: (error) => {
              if (current === generation)
                publish({ error: error.message, loading: false });
            },
          }),
        ),
    );
  };
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
      runtime.runFork(
        readDiffPreferences().pipe(
          Effect.match({
            onSuccess: (preferences) => publish({ preferences }),
            onFailure: () => undefined,
          }),
        ),
      );
    },
    stop: () => {
      owners--;
      queueMicrotask(() => {
        if (owners === 0) {
          disposed = true;
          ++generation;
          ++fileGeneration;
          void runtime.dispose();
        }
      });
    },
    selectCommit: (oid: string | undefined) => {
      if (oid !== state.oid) load(oid);
    },
    selectParent: (parent: string) => load(state.oid, parent),
    selectFile,
    retry: () => load(state.oid, parentOid),
    retryDiff: () => selectFile(state.path),
    preferences: (preferences: DiffPreferences) => {
      publish({ preferences });
      runtime.runFork(
        saveDiffPreferences(preferences).pipe(
          Effect.catch((error) =>
            Effect.sync(() => publish({ diffError: error.message })),
          ),
        ),
      );
    },
  };
}
export type CommitInspectionController = ReturnType<
  typeof createCommitInspectionController
>;
