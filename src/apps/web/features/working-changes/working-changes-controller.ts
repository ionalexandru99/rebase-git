import type {
  ChangeDiff,
  ChangeSection,
  ChangeSelection,
  ChangesScope,
  ChangesWritten,
  MutateChanges,
  RepositoryChanges,
} from "@rebase/contracts";
import {
  Effect,
  type Fiber,
  Latch,
  type ManagedRuntime,
  Semaphore,
} from "effect";
import {
  type DiffPreferences,
  defaultDiffPreferences,
} from "#web/domain/file-diff/diff-preferences.contract";
import { createCommitDraft } from "#web/features/working-changes/draft/commit-draft";
import type {
  RepositoryChangesClient,
  WorkingChangesError,
} from "#web/features/working-changes/working-changes.contract";
import {
  type CommitDraft,
  emptyCommitDraft,
  type WorkingChangesStore,
  type WorkingChangesStoreUnavailable,
} from "#web/persistence/working-changes/working-changes-store.contract";
import { createControllerScope } from "#web/platform/effect/controller-scope";
import { createStore } from "#web/platform/store/store";

type WorkingChangesFailure =
  | WorkingChangesError
  | WorkingChangesStoreUnavailable;

const fallbackRefreshMilliseconds = 10_000;

export interface WorkingChangesState {
  readonly changes: RepositoryChanges | null;
  readonly diff: ChangeDiff | null;
  readonly selection: {
    readonly path: string;
    readonly section: ChangeSection;
  } | null;
  readonly preferences: DiffPreferences;
  readonly amend: boolean;
  readonly busy: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly notice: string | null;
}
export function createWorkingChangesController(
  client: RepositoryChangesClient,
  persistence: WorkingChangesStore,
  initialScope: ChangesScope,
  draftKey: string,
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
) {
  const work = createControllerScope(runtime);
  const lock = Semaphore.makeUnsafe(1);
  const writes = Semaphore.makeUnsafe(1);
  const stale = Latch.makeUnsafe(false);
  let active = true;
  let initialized = false;
  let operationGeneration = 0;
  let watching: Fiber.Fiber<void> | undefined;
  let reading: Fiber.Fiber<unknown> | undefined;
  let normalDraft = emptyCommitDraft;
  let amendDraft: CommitDraft | undefined;
  let amendDraftHead: string | null = null;
  const store = createStore<WorkingChangesState>({
    changes: null,
    diff: null,
    selection: null,
    preferences: defaultDiffPreferences,
    amend: false,
    busy: false,
    loading: true,
    error: null,
    notice: null,
  });
  const state = store.getSnapshot;
  const publish = (next: Partial<WorkingChangesState>) => {
    if (work.open) store.set({ ...state(), ...next });
  };
  const scope = (): ChangesScope => ({ ...initialScope, amend: state().amend });
  const fail = (error: WorkingChangesFailure) =>
    Effect.sync(() => publish({ error: error.message }));
  const draft = createCommitDraft(
    persistence.saveCommitDraft,
    work,
    runtime,
    fail,
  );
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
      const selection = state().selection;
      const currentScope = scope();
      if (
        selection === null ||
        !state().changes?.[selection.section].some(
          (file) => file.path === selection.path,
        )
      ) {
        publish({ diff: null });
        return;
      }
      const diff = yield* client.diff({ ...currentScope, ...selection });
      if (
        active &&
        selection === state().selection &&
        currentScope.amend === state().amend
      )
        publish({ diff: retainedDiff(diff) });
    });
  const retainedDiff = (diff: ChangeDiff | null) =>
    diff !== null && state().diff?.revision === diff.revision
      ? state().diff
      : diff;
  const viewing = () => {
    const selection = state().selection;
    return selection === null ? {} : { viewed: selection };
  };
  const applyWritten = (
    viewed: WorkingChangesState["selection"],
    written: ChangesWritten,
    next: Partial<WorkingChangesState> = {},
  ) =>
    Effect.suspend(() => {
      const stillViewed = viewed === state().selection;
      const diffOmitted =
        stillViewed &&
        viewed !== null &&
        written.diff === null &&
        written.changes[viewed.section].some(
          (file) => file.path === viewed.path,
        );
      publish({
        ...next,
        changes: written.changes,
        ...(stillViewed ? { diff: retainedDiff(written.diff) } : {}),
      });
      return diffOmitted ? loadDiff() : Effect.void;
    });
  const refresh = () =>
    Effect.gen(function* () {
      let next = yield* client.read(scope());
      const { amend, changes } = state();
      if (amend && changes !== null && changes.head !== next.head) {
        amendDraft = undefined;
        draft.show(normalDraft);
        publish({
          amend: false,
          error:
            "HEAD changed while you were amending. Review the latest commit before enabling Amend again.",
        });
        next = yield* client.read(scope());
      }
      const first = state().changes === null;
      const changed = next.revision !== state().changes?.revision;
      if (first && state().selection === null) {
        const file =
          next.unstaged.find((candidate) => candidate.status === "U") ??
          next.unstaged[0] ??
          next.staged[0];
        if (file)
          publish({
            selection: {
              path: file.path,
              section: next.unstaged.length ? "unstaged" : "staged",
            },
          });
      }
      if (changed) publish({ changes: next, diff: null });
      if (changed || first || state().diff === null) yield* loadDiff();
      publish({ loading: false });
    });
  const operation = (
    effect: () => Effect.Effect<void, WorkingChangesFailure>,
  ) => {
    if (state().busy || state().loading) return;
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
  const refreshVisible = Effect.suspend(() =>
    document.visibilityState === "hidden"
      ? Effect.void
      : lock
          .withPermit(refresh())
          .pipe(
            Effect.catch((error) =>
              fail(error).pipe(
                Effect.andThen(Effect.sync(() => publish({ loading: false }))),
              ),
            ),
          ),
  );
  const resume = () => {
    if (!active || !initialized || watching || !work.open) {
      return;
    }
    watching = work.fork(
      Effect.forever(
        stale.close.pipe(
          Effect.andThen(refreshVisible),
          Effect.andThen(
            stale.await.pipe(Effect.timeoutOption(fallbackRefreshMilliseconds)),
          ),
        ),
      ),
    );
  };
  return {
    setActive: (next: boolean) => {
      active = next;
      if (!active) {
        work.interrupt(watching);
        work.interrupt(reading);
        watching = undefined;
        reading = undefined;
      }
      resume();
    },
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    draft: { getSnapshot: draft.getSnapshot, subscribe: draft.subscribe },
    start: () => {
      if (!work.start()) return;
      work.fork(
        Effect.gen(function* () {
          yield* persistence.readCommitDraft(draftKey).pipe(
            Effect.tap((restored) =>
              Effect.sync(() => {
                normalDraft = restored;
                draft.show(restored);
              }),
            ),
            Effect.catch(fail),
          );
          yield* persistence.readDiffPreferences().pipe(
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
      draft.flush();
      work.stop();
      watching = undefined;
      reading = undefined;
      store.set({ ...state(), busy: false, loading: false });
    },
    invalidate: () => {
      stale.openUnsafe();
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
    updateDraft: (next: CommitDraft) => {
      if (state().notice !== null) publish({ notice: null });
      if (state().amend) amendDraft = next;
      else normalDraft = next;
      draft.edit(
        state().amend ? `${draftKey}:amend:${state().changes?.head}` : draftKey,
        next,
      );
    },
    preferences: (preferences: DiffPreferences) => {
      publish({ preferences });
      run(writes.withPermit(persistence.saveDiffPreferences(preferences)));
    },
    amend: (amend: boolean) =>
      operation(() =>
        Effect.gen(function* () {
          const next = yield* client.read({ ...initialScope, amend });
          if (amend) {
            if (amendDraftHead !== next.head) amendDraft = undefined;
            amendDraftHead = next.head;
            const restored = yield* persistence
              .readCommitDraft(`${draftKey}:amend:${next.head}`)
              .pipe(Effect.catch(() => Effect.succeed(emptyCommitDraft)));
            amendDraft ??= restored.subject
              ? restored
              : splitCommitMessage(next.message);
          }
          draft.show(amend ? (amendDraft ?? emptyCommitDraft) : normalDraft);
          publish({ amend, changes: next, diff: null });
          yield* loadDiff();
        }),
      ),
    mutate: (
      action: MutateChanges["action"],
      section: ChangeSection,
      selection: ChangeSelection,
      revision = state().changes?.revision,
    ) =>
      operation(() =>
        Effect.gen(function* () {
          const { changes, selection: viewed } = state();
          if (changes === null) return;
          const written = yield* client.mutate({
            ...scope(),
            ...viewing(),
            revision: revision ?? changes.revision,
            action,
            section,
            selection,
          });
          yield* applyWritten(viewed, written);
        }),
      ),
    commit: () =>
      operation(() =>
        Effect.gen(function* () {
          const { amend, changes, selection: viewed } = state();
          if (changes === null) return;
          const amendedHead = amend ? changes.head : null;
          const { subject, description } = draft.getSnapshot();
          const message =
            subject.trim() +
            (description.trim() ? `\n\n${description.trim()}` : "");
          const written = yield* client.commit({
            ...scope(),
            ...viewing(),
            revision: changes.revision,
            message,
          });
          normalDraft = emptyCommitDraft;
          amendDraft = undefined;
          yield* applyWritten(viewed, written, {
            amend: false,
            notice: amendedHead ? "Commit amended." : "Changes committed.",
          });
          yield* draft.clear(
            amendedHead
              ? [draftKey, `${draftKey}:amend:${amendedHead}`]
              : [draftKey],
          );
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
