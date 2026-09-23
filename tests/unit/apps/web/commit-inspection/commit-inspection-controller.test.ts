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

it("restarts an interrupted inspection when the controller starts again", async () => {
  const inspect = vi.fn(() => Effect.never);
  const controller = createCommitInspectionController(
    { inspect, diff: () => Effect.die("Unused") },
    scope,
    runtime,
  );
  controller.start();
  controller.selectCommit("a".repeat(40));
  controller.stop();
  controller.start();
  try {
    expect(inspect).toHaveBeenCalledTimes(2);
  } finally {
    controller.stop();
  }
});

it("requests a renamed file's diff with its previous path", async () => {
  const oid = "a".repeat(40);
  const identity = { name: "Author", email: "author@example.test", date: "" };
  const diff = vi.fn(() => Effect.never);
  const controller = createCommitInspectionController(
    {
      inspect: () =>
        Effect.succeed({
          oid,
          message: "",
          author: identity,
          committer: identity,
          parents: [],
          parentOid: null,
          files: [{ path: "new.txt", previousPath: "old.txt", status: "R" }],
          truncated: false,
        }),
      diff,
    },
    scope,
    runtime,
  );
  controller.start();
  controller.selectCommit(oid);
  try {
    await vi.waitFor(() =>
      expect(diff).toHaveBeenCalledWith({
        ...scope,
        oid,
        path: "new.txt",
        previousPath: "old.txt",
      }),
    );
  } finally {
    controller.stop();
  }
});
