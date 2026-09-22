import type { InspectCommit } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import { Effect, Fiber } from "effect";
import { createApplicationRuntime } from "#web/features/application-runtime/index";
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
  const runtime = createApplicationRuntime();
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
  let active = true;
  const publish = (next: Partial<CommitInspectionState>) => {
    if (runtime.disposed) return;
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
    if (path === null || details === null || !active) return;
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
  const load = (oid: string | undefined) => {
    const current = ++generation;
    ++fileGeneration;
    cancel(detailsFiber);
    cancel(diffFiber);
    const previousPath = state.oid === oid ? state.path : null;
    publish({
      oid,
      details: null,
      path: previousPath,
      diff: null,
      loading: oid !== undefined,
      loadingDiff: false,
      error: null,
      diffError: null,
    });
    if (oid === undefined || !active) return;
    detailsFiber = runtime.runFork(
      client
        .inspect({
          ...scope,
          oid,
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
    setActive: (next: boolean) => {
      if (next === active) {
        return;
      }
      active = next;
      if (!active) {
        ++generation;
        ++fileGeneration;
        cancel(detailsFiber);
        cancel(diffFiber);
        publish({ loading: false, loadingDiff: false });
      } else if (state.oid !== undefined) {
        if (state.details === null) {
          load(state.oid);
        } else if (state.diff === null) {
          selectFile(state.path);
        }
      }
    },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () =>
      runtime.start(
        readDiffPreferences().pipe(
          Effect.match({
            onSuccess: (preferences) => publish({ preferences }),
            onFailure: () => undefined,
          }),
        ),
      ),
    stop: runtime.stop,
    selectCommit: (oid: string | undefined) => {
      if (oid !== state.oid) load(oid);
    },
    selectFile,
    retry: () => load(state.oid),
    retryDiff: () => selectFile(state.path),
    preferences: (preferences: DiffPreferences) => {
      publish({ preferences });
      runtime.runFork(
        saveDiffPreferences(preferences).pipe(Effect.catch(() => Effect.void)),
      );
    },
  };
}
export type CommitInspectionController = ReturnType<
  typeof createCommitInspectionController
>;
