import type { RepositoryOperation } from "@rebase/contracts/repository-operations/repository-operations.contract";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  OperationRecoveryError,
  type RepositoryOperationsClient,
} from "#web/features/operation-recovery/operation-recovery.contract";
import { createOperationRecoveryController } from "#web/features/operation-recovery/operation-recovery-controller";

const active: RepositoryOperation = {
  kind: "merge",
  phase: "ready",
  revision: "ready",
  branch: "main",
  commit: null,
  progress: null,
  unresolvedPaths: [],
  actions: [{ action: "continue", enabled: true, reason: null }],
  lock: null,
};
const uncertain = new OperationRecoveryError({
  failure: {
    _tag: "OperationFailed",
    reason: "Uncertain",
    detail: "Git's result could not be confirmed.",
    invalidation: { status: true, refs: true, history: true },
  },
});

function fixture(client: RepositoryOperationsClient) {
  const controller = createOperationRecoveryController(
    client,
    { repositoryId: "repo", worktreePath: "/repo" },
    vi.fn(),
  );
  controller.start();
  controller.connect(true);
  return controller;
}

describe("operation recovery feedback", () => {
  it("clears a failed read when the next inspection succeeds", async () => {
    const read = vi.fn<RepositoryOperationsClient["read"]>(() =>
      Effect.succeed(active),
    );
    read.mockReturnValueOnce(Effect.fail(uncertain));
    const controller = fixture({ read, execute: () => Effect.fail(uncertain) });
    try {
      await vi.waitFor(() =>
        expect(controller.getSnapshot().error).toEqual(uncertain.failure),
      );
      controller.refresh();
      await vi.waitFor(() => {
        expect(controller.getSnapshot().checking).toBe(false);
        expect(controller.getSnapshot().error).toBeNull();
      });
    } finally {
      controller.stop();
    }
  });

  it("keeps an uncertain mutation visible when inspection finds the operation finished", async () => {
    let current = active;
    const execute = vi.fn(() => {
      current = {
        ...active,
        kind: "idle",
        phase: "idle",
        revision: "done",
        actions: [],
      };
      return Effect.fail(uncertain);
    });
    const controller = fixture({
      read: () => Effect.succeed(current),
      execute,
    });
    try {
      await vi.waitFor(() =>
        expect(controller.getSnapshot().checking).toBe(false),
      );
      controller.execute("continue", active.revision);
      await vi.waitFor(() => {
        expect(controller.getSnapshot().operation?.kind).toBe("idle");
        expect(controller.getSnapshot().busy).toBe(false);
      });
      expect(controller.getSnapshot().error).toEqual(uncertain.failure);
      expect(controller.getSnapshot().completed).toBeNull();
      controller.refresh();
      await vi.waitFor(() =>
        expect(controller.getSnapshot().checking).toBe(false),
      );
      expect(controller.getSnapshot().error).toEqual(uncertain.failure);
      expect(execute).toHaveBeenCalledOnce();
      controller.checkAgain();
      await vi.waitFor(() => expect(controller.getSnapshot().error).toBeNull());
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      controller.stop();
    }
  });
});
