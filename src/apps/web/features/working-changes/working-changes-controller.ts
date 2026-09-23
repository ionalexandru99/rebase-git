import type {
  ChangeDiff,
  ChangeSection,
  ChangeSelection,
  ChangesScope,
  MutateChanges,
  RepositoryChanges,
} from "@rebase/contracts";
import { Effect, type Fiber, type ManagedRuntime, Semaphore } from "effect";
import {
  type DiffPreferences,
  defaultDiffPreferences,
} from "#web/domain/file-diff/diff-preferences.contract";
import {
  type CommitDraft,
  emptyCommitDraft,
} from "#web/domain/working-changes/commit-draft.contract";
import type {
  RepositoryChangesClient,
  WorkingChangesError,
} from "#web/features/working-changes/working-changes.contract";
import {
  readCommitDraft,
  readDiffPreferences,
  saveCommitDraft,
  saveDiffPreferences,
} from "#web/persistence/working-changes/working-changes-store";
import type { WorkingChangesStoreUnavailable } from "#web/persistence/working-changes/working-changes-store.contract";
import { createControllerScope } from "#web/platform/effect/controller-scope";

type WorkingChangesFailure =
  | WorkingChangesError
  | WorkingChangesStoreUnavailable;

export interface WorkingChangesState {
  readonly changes: RepositoryChanges | null;
  readonly diff: ChangeDiff | null;
  readonly selection: {
    readonly path: string;
    readonly section: ChangeSection;
  } | null;
  readonly draft: CommitDraft;
  readonly preferences: DiffPreferences;
  readonly amend: boolean;
  readonly busy: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly notice: string | null;
}
export function createWorkingChangesController(
  client: RepositoryChangesClient,
  initialScope: ChangesScope,
  draftKey: string,
  onCommitted: () => void,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
) {
  const work = createControllerScope(runtime);
  const lock = Semaphore.makeUnsafe(1);
  const writes = Semaphore.makeUnsafe(1);
  const listeners = new Set<() => void>();
  let active = true;
  let initialized = false;
  let operationGeneration = 0;
  let polling: Fiber.Fiber<void> | undefined;
  let reading: Fiber.Fiber<unknown> | undefined;
  let normalDraft = emptyCommitDraft;
  let amendDraft: CommitDraft | undefined;
  let amendDraftHead: string | null = null;
  let state: WorkingChangesState = {
    changes: null,
    diff: null,
    selection: null,
    draft: emptyCommitDraft,
    preferences: defaultDiffPreferences,
    amend: false,
    busy: false,
    loading: true,
    error: null,
    notice: null,
  };
  const publish = (next: Partial<WorkingChangesState>) => {
    if (!work.open) return;
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const scope = (): ChangesScope => ({ ...initialScope, amend: state.amend });
  const fail = (error: WorkingChangesFailure) =>
    Effect.sync(() => publish({ error: error.message }));
  const run = (effect: Effect.Effect<unknown, WorkingChangesFailure>) =>
    work.fork(effect.pipe(Effect.catch(fail)));
  const runRead = (effect: Effect.Effect<unknown, WorkingChangesFailure>) => {
    work.interrupt(reading);
    if (active) {
      reading = run(effect);
    }
  };
  const loadDiff = () =>
    Effect.gen(function* () {
      if (!active) {
        return;
      }
      const selection = state.selection;
      const currentScope = scope();
      if (
        selection === null ||
        !state.changes?.[selection.section].some(
          (file) => file.path === selection.path,
        )
      ) {
        publish({ diff: null });
        return;
      }
      const diff = yield* client.diff({ ...currentScope, ...selection });
      if (
        active &&
        selection === state.selection &&
        currentScope.amend === state.amend
      )
        publish({
          diff: state.diff?.revision === diff.revision ? state.diff : diff,
        });
    });
  const refresh = () =>
    Effect.gen(function* () {
      let next = yield* client.read(scope());
      if (
        state.amend &&
        state.changes !== null &&
        state.changes.head !== next.head
      ) {
        amendDraft = undefined;
        publish({
          amend: false,
          draft: normalDraft,
          error:
            "HEAD changed while you were amending. Review the latest commit before enabling Amend again.",
        });
        next = yield* client.read(scope());
      }
      const first = state.changes === null;
      const changed = next.revision !== state.changes?.revision;
      if (first && state.selection === null) {
        const file = next.unstaged[0] ?? next.staged[0];
        if (file)
          publish({
            selection: {
              path: file.path,
              section: next.unstaged.length ? "unstaged" : "staged",
            },
          });
      }
      if (changed) publish({ changes: next, diff: null });
      if (changed || first || state.diff === null) yield* loadDiff();
      publish({ loading: false });
    });
  const operation = (
    effect: () => Effect.Effect<void, WorkingChangesFailure>,
  ) => {
    if (state.busy || state.loading) return;
    const generation = ++operationGeneration;
    publish({ busy: true, error: null, notice: null });
    run(
      lock.withPermit(Effect.suspend(effect)).pipe(
        Effect.catch((error) =>
          fail(error).pipe(
            Effect.andThen(refresh().pipe(Effect.catch(() => Effect.void))),
          ),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (generation === operationGeneration) {
              publish({ busy: false, loading: false });
            }
          }),
        ),
      ),
    );
  };
  const resume = () => {
    if (!active || !initialized || polling || !work.open) {
      return;
    }
    polling = work.fork(
      Effect.forever(
        Effect.suspend(() =>
          document.visibilityState === "hidden" || state.busy
            ? Effect.void
            : lock
                .withPermit(refresh())
                .pipe(
                  Effect.catch((error) =>
                    fail(error).pipe(
                      Effect.andThen(
                        Effect.sync(() => publish({ loading: false })),
                      ),
                    ),
                  ),
                ),
        ).pipe(Effect.andThen(Effect.sleep(2500))),
      ),
    );
  };
  return {
    setActive: (next: boolean) => {
      active = next;
      if (!active) {
        work.interrupt(polling);
        work.interrupt(reading);
        polling = undefined;
        reading = undefined;
      }
      resume();
    },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      if (!work.start()) return;
      work.fork(
        Effect.gen(function* () {
          yield* readCommitDraft(draftKey).pipe(
            Effect.tap((draft) =>
              Effect.sync(() => {
                normalDraft = draft;
                publish({ draft });
              }),
            ),
            Effect.catch(fail),
          );
          yield* readDiffPreferences().pipe(
            Effect.tap((preferences) =>
              Effect.sync(() => publish({ preferences })),
            ),
            Effect.catch(fail),
          );
          initialized = true;
          resume();
        }).pipe(Effect.catch(fail)),
      );
    },
    stop: () => {
      ++operationGeneration;
      work.stop();
      polling = undefined;
      reading = undefined;
      state = { ...state, busy: false, loading: false };
      for (const listener of listeners) {
        listener();
      }
    },
    refresh: () =>
      runRead(
        lock
          .withPermit(refresh())
          .pipe(Effect.tap(() => Effect.sync(() => publish({ error: null })))),
      ),
    select: (section: ChangeSection, path: string) => {
      publish({ selection: { section, path }, diff: null });
      runRead(lock.withPermit(loadDiff()));
    },
    updateDraft: (draft: CommitDraft) => {
      publish({ draft, notice: null });
      if (state.amend) amendDraft = draft;
      else normalDraft = draft;
      const key = state.amend
        ? `${draftKey}:amend:${state.changes?.head}`
        : draftKey;
      run(writes.withPermit(saveCommitDraft(key, draft)));
    },
    preferences: (preferences: DiffPreferences) => {
      publish({ preferences });
      run(writes.withPermit(saveDiffPreferences(preferences)));
    },
    amend: (amend: boolean) =>
      operation(() =>
        Effect.gen(function* () {
          const next = yield* client.read({ ...initialScope, amend });
          if (amend) {
            if (amendDraftHead !== next.head) amendDraft = undefined;
            amendDraftHead = next.head;
            const restored = yield* readCommitDraft(
              `${draftKey}:amend:${next.head}`,
            ).pipe(Effect.catch(() => Effect.succeed(emptyCommitDraft)));
            amendDraft ??= restored.subject
              ? restored
              : splitCommitMessage(next.message);
          }
          publish({
            amend,
            changes: next,
            draft: amend ? (amendDraft ?? emptyCommitDraft) : normalDraft,
            diff: null,
          });
          yield* loadDiff();
        }),
      ),
    mutate: (
      action: MutateChanges["action"],
      section: ChangeSection,
      selection: ChangeSelection,
      revision = state.changes?.revision,
    ) =>
      operation(() =>
        Effect.gen(function* () {
          if (state.changes === null) return;
          const next = yield* client.mutate({
            ...scope(),
            revision: revision ?? state.changes.revision,
            action,
            section,
            selection,
          });
          publish({ changes: next, diff: null });
          yield* loadDiff();
        }),
      ),
    commit: () =>
      operation(() =>
        Effect.gen(function* () {
          if (state.changes === null) return;
          const amendedHead = state.amend ? state.changes.head : null;
          const message =
            state.draft.subject.trim() +
            (state.draft.description.trim()
              ? `\n\n${state.draft.description.trim()}`
              : "");
          const next = yield* client.commit({
            ...scope(),
            revision: state.changes.revision,
            message,
          });
          normalDraft = emptyCommitDraft;
          amendDraft = undefined;
          publish({
            changes: next,
            diff: null,
            draft: emptyCommitDraft,
            amend: false,
            notice: amendedHead ? "Commit amended." : "Changes committed.",
          });
          onCommitted();
          yield* writes
            .withPermit(saveCommitDraft(draftKey, emptyCommitDraft))
            .pipe(Effect.catch(fail));
          if (amendedHead)
            yield* writes
              .withPermit(
                saveCommitDraft(
                  `${draftKey}:amend:${amendedHead}`,
                  emptyCommitDraft,
                ),
              )
              .pipe(Effect.catch(fail));
          yield* loadDiff();
        }),
      ),
  };
}
export type WorkingChangesController = ReturnType<
  typeof createWorkingChangesController
>;

function splitCommitMessage(message: string): CommitDraft {
  const [subject = "", ...body] = message.split("\n");
  return { subject, description: body.join("\n").trimStart() };
}
