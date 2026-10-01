import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { RepositoryChangeKind } from "#contracts/environment-connection/environment-rpc.contract.ts";
import {
  type RepositoryOperation,
  RepositoryOperationsApi,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  conflictedRebase,
  repositoryOperation,
  repositoryScope,
} from "#tests-support/fixtures.ts";
import {
  render,
  testChanges,
  testEnvironment,
} from "#tests-support/render.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import {
  OperationRecoveryNotice,
  OperationRecoveryToast,
} from "#web/features/operation-recovery/components/operation-recovery-toast.tsx";
import type { OperationRecoveryState } from "#web/features/operation-recovery/hooks/use-operation-recovery.ts";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import { EnvironmentProvider } from "#web/platform/query/environment-context.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

function snapshot(value = conflictedRebase()): OperationRecoveryState {
  return {
    operation: value,
    connected: true,
    checking: false,
    busy: false,
    error: null,
    completed: null,
  };
}

async function fixture(initial = snapshot()) {
  const execute = vi.fn(),
    review = vi.fn(),
    refresh = vi.fn(),
    dismiss = vi.fn();
  const tree = (state = initial) => (
    <PersistentNotification>
      <OperationRecoveryToast
        state={state}
        repositoryName="catalog-api"
        writable
        execute={execute}
        review={review}
        refresh={refresh}
        dismiss={dismiss}
      />
    </PersistentNotification>
  );
  const view = await render(tree());
  return { view, tree, execute, review, refresh, dismiss };
}

describe("operation recovery toast", () => {
  it("opens conflicts and collapses without dismissing the operation", async () => {
    const f = await fixture();
    await page.getByRole("button", { name: "Review conflicts" }).click();
    expect(f.review).toHaveBeenCalledOnce();
    await expect
      .element(page.getByRole("button", { name: "Expand operation" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Actions" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Expand operation" }).click();
    await expect
      .element(page.getByRole("button", { name: "Actions" }))
      .toBeVisible();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("offers only merge actions and executes a confirmed abort with the observed revision", async () => {
    const merge = conflictedRebase({
      kind: "merge",
      progress: null,
      actions: [
        {
          action: "continue",
          enabled: false,
          reason: "Resolve conflicts first.",
        },
        { action: "abort", enabled: true, reason: null },
      ],
    });
    const f = await fixture(snapshot(merge));
    await page.getByRole("button", { name: "Actions" }).click();
    await expect
      .element(page.getByRole("menuitem", { name: "Skip commit…" }))
      .not.toBeInTheDocument();
    await page.getByRole("menuitem", { name: "Abort…" }).click();
    await expect
      .element(page.getByRole("button", { name: "Cancel", exact: true }))
      .toHaveFocus();
    expect(f.execute).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Abort", exact: true }).click();
    expect(f.execute).toHaveBeenCalledExactlyOnceWith("abort", "one");
  });

  it("invalidates an open confirmation when external Git state changes", async () => {
    const f = await fixture();
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Skip commit…" }).click();
    await f.view.rerender(
      f.tree(snapshot(conflictedRebase({ revision: "two" }))),
    );
    await expect
      .element(page.getByRole("button", { name: "Skip", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(
        page.getByText("Git state changed. Review the available actions."),
      )
      .toBeVisible();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("makes Continue keyboard accessible and prevents execution while disconnected", async () => {
    const state = snapshot(
      conflictedRebase({
        phase: "edit",
        unresolvedPaths: [],
        actions: [
          { action: "continue", enabled: true, reason: null },
          { action: "abort", enabled: true, reason: null },
        ],
      }),
    );
    const f = await fixture(state);
    await page
      .getByRole("button", { name: "Continue rebase" })
      .element()
      .focus();
    await userEvent.keyboard("{Enter}");
    expect(f.execute).toHaveBeenCalledExactlyOnceWith("continue", "one");
    await f.view.rerender(f.tree({ ...state, connected: false }));
    await expect
      .element(page.getByRole("button", { name: "Continue rebase" }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Actions" }))
      .toBeDisabled();
  });

  it("rediscovers after reconnect and repository changes without repeating a mutation", async () => {
    const f = await liveFixture(readyToContinue());
    await expect
      .element(page.getByRole("button", { name: "Continue rebase" }))
      .toBeEnabled();
    await f.connect(false);
    await expect
      .element(page.getByRole("button", { name: "Continue rebase" }))
      .toBeDisabled();
    const release = f.hold();
    await f.connect(true);
    await expect
      .element(page.getByRole("heading", { name: "Checking Git state…" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Continue rebase" }))
      .toBeDisabled();
    f.set(idle());
    release();
    await expect
      .element(page.getByRole("region", { name: "Git operation" }))
      .not.toBeInTheDocument();
    f.set(conflictedRebase());
    f.change("Refs");
    await expect
      .element(page.getByRole("button", { name: "Review conflicts" }))
      .toBeVisible();
    f.set(
      conflictedRebase({
        revision: "two",
        unresolvedPaths: ["a.txt", "b.txt"],
      }),
    );
    f.change("Index");
    await expect
      .element(
        page.getByRole("heading", { name: "Rebase · 2 conflicts · 3/8" }),
      )
      .toBeVisible();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("keeps a failed action toast when the next read finds the operation finished", async () => {
    const f = await liveFixture(readyToContinue());
    f.execute.mockImplementation(() => {
      f.set(idle());
      throw rejected({
        _tag: "OperationFailed",
        reason: "Uncertain",
        detail: "Git stopped responding.",
      });
    });
    await page.getByRole("button", { name: "Continue rebase" }).click();
    await expect
      .element(page.getByText("Git stopped responding."))
      .toBeVisible();
    const reads = f.read.mock.calls.length;
    f.change("Refs");
    await expect.poll(() => f.read.mock.calls.length).toBeGreaterThan(reads);
    await expect
      .element(page.getByRole("region", { name: "Git operation" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText("Git stopped responding."))
      .toBeVisible();
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it("shows the executed result without waiting for another read", async () => {
    const f = await liveFixture(readyToContinue());
    f.execute.mockImplementation(() => idle());
    await page.getByRole("button", { name: "Continue rebase" }).click();
    await expect
      .element(page.getByRole("heading", { name: "Rebase completed" }))
      .toBeVisible();
    expect(f.execute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: "continue", revision: "one" }),
    );
    expect(f.read).toHaveBeenCalledOnce();
  });

  it("forgets a completed operation once another operation starts", async () => {
    const f = await liveFixture(readyToContinue());
    f.execute.mockImplementation(() => idle());
    await page.getByRole("button", { name: "Continue rebase" }).click();
    await expect
      .element(page.getByRole("heading", { name: "Rebase completed" }))
      .toBeVisible();

    f.set(conflictedRebase({ kind: "merge", progress: null }));
    f.change("Index");
    await expect
      .element(page.getByRole("button", { name: "Review conflicts" }))
      .toBeVisible();
    f.set(idle());
    f.change("Index");

    await expect
      .element(page.getByRole("region", { name: "Git operation" }))
      .not.toBeInTheDocument();
  });
});

function readyToContinue() {
  return conflictedRebase({
    phase: "ready",
    unresolvedPaths: [],
    actions: [{ action: "continue", enabled: true, reason: null }],
  });
}

function idle() {
  return repositoryOperation({ revision: "finished" });
}

async function liveFixture(initial: RepositoryOperation) {
  let current = initial;
  let gate = Promise.resolve();
  const environmentChanges = testChanges();
  const read = vi.fn(async () => {
    await gate;
    return current;
  });
  const execute = vi.fn<(command: unknown) => RepositoryOperation>(
    () => current,
  );
  const requests = fakeRequests(
    respond(RepositoryOperationsApi.read, async () => read()),
    respond(RepositoryOperationsApi.execute, async (command) =>
      execute(command),
    ),
  );
  const scope = repositoryScope({ repositoryId: "repo" });
  const tree = (connected: boolean) => (
    <EnvironmentProvider
      environment={testEnvironment({
        environmentId: "environment",
        requests,
        connected,
      })}
    >
      <RepositoryScopeProvider scope={{ ...scope, connected }}>
        <WorkspacePanel.Provider scopeKey="operation-test">
          <OperationRecoveryNotice repositoryName="catalog-api" />
        </WorkspacePanel.Provider>
      </RepositoryScopeProvider>
    </EnvironmentProvider>
  );
  const view = await render(tree(true), {
    queryClient: environmentChanges.queryClient,
  });
  return {
    read,
    execute,
    set: (next: RepositoryOperation) => {
      current = next;
    },
    hold: () => {
      const released = Promise.withResolvers<void>();
      gate = released.promise;
      return () => released.resolve();
    },
    connect: (connected: boolean) => {
      if (connected) environmentChanges.publish();
      return view.rerender(tree(connected));
    },
    change: (kind: RepositoryChangeKind) =>
      environmentChanges.publish(["repo"], kind),
  };
}
