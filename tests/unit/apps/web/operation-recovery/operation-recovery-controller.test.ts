import type { RepositoryOperation } from "@rebase/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  OperationRecoveryError,
  type RepositoryOperationsClient,
} from "#web/features/operation-recovery/operation-recovery.contract";
import {
  createOperationRecoveryController,
  type OperationRecoveryController,
} from "#web/features/operation-recovery/operation-recovery-controller";

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
  message: "Git's result could not be confirmed.",
});

async function withController(
  client: RepositoryOperationsClient,
  use: (controller: OperationRecoveryController) => Promise<void>,
) {
  vi.stubGlobal("document", { visibilityState: "visible" });
  const runtime = ManagedRuntime.make(Layer.empty);
  const controller = createOperationRecoveryController(
    client,
    { repositoryId: "repo", worktreePath: "/repo" },
    runtime,
  );
  try {
    controller.start();
    controller.connect(true);
    await use(controller);
  } finally {
    controller.stop();
    await runtime.dispose();
    vi.unstubAllGlobals();
  }
}

describe("operation recovery feedback", () => {
  it("clears a failed read when the next inspection succeeds", () => {
    const read = vi.fn<RepositoryOperationsClient["read"]>(() =>
      Effect.succeed(active),
    );
    read.mockReturnValueOnce(Effect.fail(uncertain));
    return withController(
      { read, execute: () => Effect.fail(uncertain) },
      async (controller) => {
        await vi.waitFor(() =>
          expect(controller.getSnapshot().error).toBe(uncertain.message),
        );
        controller.invalidate();
        await vi.waitFor(() => {
          expect(controller.getSnapshot().checking).toBe(false);
          expect(controller.getSnapshot().error).toBeNull();
        });
      },
    );
  });

  it("keeps an uncertain mutation visible when inspection finds the operation finished", () => {
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
    return withController(
      { read: () => Effect.succeed(current), execute },
      async (controller) => {
        await vi.waitFor(() =>
          expect(controller.getSnapshot().checking).toBe(false),
        );
        controller.execute("continue", active.revision);
        await vi.waitFor(() => {
          expect(controller.getSnapshot().operation?.kind).toBe("idle");
          expect(controller.getSnapshot().busy).toBe(false);
        });
        expect(controller.getSnapshot().error).toBe(uncertain.message);
        expect(controller.getSnapshot().completed).toBeNull();
        controller.invalidate();
        await vi.waitFor(() =>
          expect(controller.getSnapshot().checking).toBe(false),
        );
        expect(controller.getSnapshot().error).toBe(uncertain.message);
        controller.checkAgain();
        await vi.waitFor(() =>
          expect(controller.getSnapshot().error).toBeNull(),
        );
        expect(execute).toHaveBeenCalledOnce();
      },
    );
  });
});
