import { Effect } from "effect";
import { expect, it, vi } from "vite-plus/test";
import { createCommitInspectionController } from "#web/features/commit-inspection/commit-inspection-controller";
import { defaultDiffPreferences } from "#web/features/file-diff/file-diff.contract";
import { WorkingChangesError } from "#web/features/working-changes/working-changes.contract";
import { saveDiffPreferences } from "#web/persistence/working-changes/working-changes-store";

vi.mock("#web/persistence/working-changes/working-changes-store", () => ({
  readDiffPreferences: () => Effect.succeed(defaultDiffPreferences),
  saveDiffPreferences: vi.fn(),
}));

it("keeps inspection state available when saving display preferences fails", async () => {
  let failed = false;
  vi.mocked(saveDiffPreferences).mockReturnValue(
    Effect.fail(
      new WorkingChangesError({ message: "Storage unavailable" }),
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
    { repositoryId: "repository", worktreePath: "/repository" },
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
