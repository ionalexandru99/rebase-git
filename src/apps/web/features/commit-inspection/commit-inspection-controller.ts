import type { InspectCommit } from "@rebase/contracts";
import { Effect, type Fiber, type ManagedRuntime } from "effect";
import {
  type DiffPreferences,
  defaultDiffPreferences,
} from "#web/domain/file-diff/diff-preferences.contract";
import type {
  CommitInspectionClient,
  CommitInspectionState,
} from "#web/features/commit-inspection/commit-inspection.contract";
import type { DiffPreferencesStore } from "#web/persistence/working-changes/working-changes-store.contract";
import { createControllerScope } from "#web/platform/effect/controller-scope";
import { createStore } from "#web/platform/store/store";

export function createCommitInspectionController(
  client: CommitInspectionClient,
  persistence: DiffPreferencesStore,
  scope: Pick<InspectCommit, "repositoryId" | "worktreePath">,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
) {
  const work = createControllerScope(runtime);
  const store = createStore<CommitInspectionState>({
    oid: undefined,
    details: null,
    path: null,
    diff: null,
    loading: false,
    loadingDiff: false,
    error: null,
    diffError: null,
    preferences: defaultDiffPreferences,
  });
  const state = store.getSnapshot;
  let detailsFiber: Fiber.Fiber<void> | undefined;
  let diffFiber: Fiber.Fiber<void> | undefined;
  let generation = 0;
  let fileGeneration = 0;
  let active = true;
  const publish = (next: Partial<CommitInspectionState>) => {
    if (work.open) store.set({ ...state(), ...next });
  };
  const selectFile = (path: string | null) => {
    if (
      path === state().path &&
      state().diffError === null &&
      (state().diff !== null || state().loadingDiff)
    )
      return;
    const current = ++fileGeneration;
    work.interrupt(diffFiber);
    publish({
      path,
      diff: null,
      diffError: null,
      loadingDiff: path !== null && active,
    });
    const details = state().details;
    if (path === null || details === null || !active) return;
    const previousPath = details.files.find(
      (file) => file.path === path,
    )?.previousPath;
    diffFiber = work.fork(
      client
        .diff({
          ...scope,
          oid: details.oid,
          ...(details.parentOid === null
            ? {}
            : { parentOid: details.parentOid }),
          path,
          ...(previousPath == null ? {} : { previousPath }),
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
    work.interrupt(detailsFiber);
    work.interrupt(diffFiber);
    const previousPath = state().oid === oid ? state().path : null;
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
    detailsFiber = work.fork(
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
        work.interrupt(detailsFiber);
        work.interrupt(diffFiber);
        publish({ loading: false, loadingDiff: false });
      } else if (state().oid !== undefined) {
        if (state().details === null) {
          load(state().oid);
        } else if (state().diff === null) {
          selectFile(state().path);
        }
      }
    },
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    start: () => {
      if (!work.start()) {
        return;
      }
      if (active && state().oid !== undefined) {
        load(state().oid);
      }
      work.fork(
        persistence.readDiffPreferences().pipe(
          Effect.match({
            onSuccess: (preferences) => publish({ preferences }),
            onFailure: () => undefined,
          }),
        ),
      );
    },
    stop: work.stop,
    selectCommit: (oid: string | undefined) => {
      if (oid !== state().oid) load(oid);
    },
    selectFile,
    retry: () => load(state().oid),
    retryDiff: () => selectFile(state().path),
    preferences: (preferences: DiffPreferences) => {
      publish({ preferences });
      work.fork(
        persistence
          .saveDiffPreferences(preferences)
          .pipe(Effect.catch(() => Effect.void)),
      );
    },
  };
}
export type CommitInspectionController = ReturnType<
  typeof createCommitInspectionController
>;
