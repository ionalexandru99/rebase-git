import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, it, vi } from "vite-plus/test";
import { defaultDiffPreferences } from "#web/domain/file-diff/diff-preferences.contract";
import { emptyCommitDraft } from "#web/domain/working-changes/commit-draft.contract";
import { createWorkingChangesController } from "#web/features/working-changes/working-changes-controller";

vi.mock("#web/persistence/working-changes/working-changes-store", () => ({
  readDiffPreferences: () => Effect.succeed(defaultDiffPreferences),
  readCommitDraft: () => Effect.succeed(emptyCommitDraft),
  saveDiffPreferences: () => Effect.void,
  saveCommitDraft: () => Effect.void,
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
    { repositoryId: "repository", worktreePath: "/repository", amend: false },
    "draft",
    () => undefined,
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
