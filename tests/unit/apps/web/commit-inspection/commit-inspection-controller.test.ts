import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, it, vi } from "vite-plus/test";
import { defaultDiffPreferences } from "#web/domain/file-diff/diff-preferences.contract";
import { createCommitInspectionController } from "#web/features/commit-inspection/commit-inspection-controller";
import { saveDiffPreferences } from "#web/persistence/working-changes/working-changes-store";
import { WorkingChangesStoreUnavailable } from "#web/persistence/working-changes/working-changes-store.contract";

vi.mock("#web/persistence/working-changes/working-changes-store", () => ({
  readDiffPreferences: () => Effect.succeed(defaultDiffPreferences),
  saveDiffPreferences: vi.fn(),
}));

const runtime = ManagedRuntime.make(Layer.empty);
const scope = { repositoryId: "repository", worktreePath: "/repository" };

it("keeps inspection state available when saving display preferences fails", async () => {
  let failed = false;
  vi.mocked(saveDiffPreferences).mockReturnValue(
    Effect.fail(
      new WorkingChangesStoreUnavailable({ message: "Storage unavailable" }),
    ).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          failed = true;
        }),
      ),
    ),
  );
  const controller = createCommitInspectionController(
    { inspect: () => Effect.die("Unused"), diff: () => Effect.die("Unused") },
    scope,
    runtime,
  );
  controller.start();
  try {
    await vi.waitFor(() =>
      expect(controller.getSnapshot().preferences).toEqual(
        defaultDiffPreferences,
      ),
    );
    controller.preferences({ ...defaultDiffPreferences, split: true });
    await vi.waitFor(() => expect(failed).toBe(true));
    expect(controller.getSnapshot().diffError).toBeNull();
  } finally {
    controller.stop();
  }
});

it("interrupts the in-flight inspection when stopped", async () => {
  let interrupted = false;
  const controller = createCommitInspectionController(
    {
      inspect: () =>
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
      diff: () => Effect.die("Unused"),
    },
    scope,
    runtime,
  );
  controller.start();
  controller.selectCommit("a".repeat(40));
  expect(controller.getSnapshot().loading).toBe(true);
  controller.stop();
  await vi.waitFor(() => expect(interrupted).toBe(true));
});
