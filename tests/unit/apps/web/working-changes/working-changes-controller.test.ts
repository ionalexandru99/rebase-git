import { Effect, Layer, ManagedRuntime } from "effect";
import { TestClock } from "effect/testing";
import { expect, it, vi } from "vite-plus/test";
import { defaultDiffPreferences } from "#web/domain/file-diff/diff-preferences.contract";
import {
  createWorkingChangesController,
  type WorkingChangesController,
} from "#web/features/working-changes/working-changes-controller";
import {
  emptyCommitDraft,
  type WorkingChangesStore,
} from "#web/persistence/working-changes/working-changes-store.contract";

const saveCommitDraft = vi.fn<WorkingChangesStore["saveCommitDraft"]>(
  () => Effect.void,
);
const persistence: WorkingChangesStore = {
  readDiffPreferences: () => Effect.succeed(defaultDiffPreferences),
  readCommitDraft: () => Effect.succeed(emptyCommitDraft),
  saveDiffPreferences: () => Effect.void,
  saveCommitDraft,
};

const emptyChanges = {
  revision: "one",
  head: null,
  message: "",
  unstaged: [],
  staged: [],
  truncated: false,
  renamesLimited: false,
};

async function withStartedController(
  use: (controller: WorkingChangesController) => Promise<void>,
) {
  vi.stubGlobal("document", { visibilityState: "visible" });
  saveCommitDraft.mockClear();
  const runtime = ManagedRuntime.make(Layer.empty);
  const controller = createWorkingChangesController(
    {
      read: () => Effect.succeed(emptyChanges),
      mutate: () => Effect.never,
      diff: () => Effect.never,
      commit: () => Effect.never,
    },
    persistence,
    { repositoryId: "repository", worktreePath: "/repository", amend: false },
    "draft",
    runtime,
  );
  try {
    controller.start();
    await vi.waitFor(() =>
      expect(controller.getSnapshot().loading).toBe(false),
    );
    await use(controller);
  } finally {
    controller.stop();
    await runtime.dispose();
    vi.unstubAllGlobals();
  }
}

it("keeps typing out of the panel state and saves the draft once typing pauses", () =>
  withStartedController(async (controller) => {
    const published = vi.fn();
    controller.subscribe(published);
    controller.updateDraft({ subject: "F", description: "" });
    controller.updateDraft({ subject: "Fi", description: "" });
    controller.updateDraft({ subject: "Fix", description: "" });
    expect(controller.draft.getSnapshot()).toEqual({
      subject: "Fix",
      description: "",
    });
    await vi.waitFor(() => expect(saveCommitDraft).toHaveBeenCalledOnce());
    expect(saveCommitDraft).toHaveBeenCalledWith("draft", {
      subject: "Fix",
      description: "",
    });
    expect(published).not.toHaveBeenCalled();
  }));

it("saves a draft typed just before the panel closes", () =>
  withStartedController(async (controller) => {
    controller.updateDraft({ subject: "Unsaved", description: "" });
    controller.stop();
    await vi.waitFor(() =>
      expect(saveCommitDraft).toHaveBeenCalledWith("draft", {
        subject: "Unsaved",
        description: "",
      }),
    );
  }));

it("allows mutations after stopping and restarting an interrupted operation", async () => {
  vi.stubGlobal("document", { visibilityState: "visible" });
  const runtime = ManagedRuntime.make(Layer.empty);
  const read = vi.fn(() =>
    Effect.succeed({
      revision: "one",
      head: null,
      message: "",
      unstaged: [],
      staged: [],
      truncated: false,
      renamesLimited: false,
    }),
  );
  const interrupted = Promise.withResolvers<void>();
  const mutate = vi
    .fn(() => Effect.never)
    .mockImplementationOnce(() =>
      Effect.never.pipe(
        Effect.onInterrupt(() => Effect.promise(() => interrupted.promise)),
      ),
    );
  const controller = createWorkingChangesController(
    { read, mutate, diff: () => Effect.never, commit: () => Effect.never },
    persistence,
    { repositoryId: "repository", worktreePath: "/repository", amend: false },
    "draft",
    runtime,
  );
  try {
    controller.start();
    await vi.waitFor(() =>
      expect(controller.getSnapshot().loading).toBe(false),
    );
    controller.mutate("stage", "unstaged", { _tag: "All" });
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(controller.getSnapshot().busy).toBe(true);
    controller.stop();
    expect(controller.getSnapshot().busy).toBe(false);
    controller.start();
    controller.mutate("stage", "unstaged", { _tag: "All" });
    expect(controller.getSnapshot().busy).toBe(true);
    interrupted.resolve();
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(controller.getSnapshot().busy).toBe(true);
    controller.mutate("stage", "unstaged", { _tag: "All" });
    expect(mutate).toHaveBeenCalledTimes(2);
  } finally {
    interrupted.resolve();
    controller.stop();
    await runtime.dispose();
    vi.unstubAllGlobals();
  }
});

it("stops refreshing while inactive and refreshes again once active", async () => {
  vi.stubGlobal("document", { visibilityState: "visible" });
  const runtime = ManagedRuntime.make(TestClock.layer());
  const read = vi.fn(() => Effect.succeed(emptyChanges));
  const controller = createWorkingChangesController(
    {
      read,
      mutate: () => Effect.never,
      diff: () => Effect.never,
      commit: () => Effect.never,
    },
    persistence,
    { repositoryId: "repository", worktreePath: "/repository", amend: false },
    "draft",
    runtime,
  );
  try {
    controller.start();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await runtime.runPromise(TestClock.adjust(10_000));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));

    controller.setActive(false);
    controller.invalidate();
    await runtime.runPromise(TestClock.adjust(60_000));
    expect(read).toHaveBeenCalledTimes(2);

    controller.setActive(true);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  } finally {
    controller.stop();
    await runtime.dispose();
    vi.unstubAllGlobals();
  }
});
