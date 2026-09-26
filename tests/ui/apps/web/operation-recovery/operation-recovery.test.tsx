import {
  type RepositoryChangeKind,
  type RepositoryOperation,
  RepositoryOperationsHttpApi,
} from "@rebase/contracts";
import { EnvironmentHttpRejected } from "@rebase/environment-client";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import { fakeRequests, respond } from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import {
  ErrorNotification,
  NotificationsProvider,
  PersistentNotification,
} from "#web/features/notifications/index";
import { RepositoryScopeProvider } from "#web/features/repository-scope/index";
import type { EnvironmentChangeListener } from "#web/platform/environment/environment-protocol.contract";
import { OperationRecoveryNotice } from "#web-ui/features/operation-recovery/components/operation-recovery-notice";
import {
  type OperationRecoveryState,
  OperationRecoveryToast,
} from "#web-ui/features/operation-recovery/components/operation-recovery-toast";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";
import { EnvironmentProvider } from "#web-ui/platform/query/environment-context";

function operation(
  patch: Partial<RepositoryOperation> = {},
): RepositoryOperation {
  return {
    kind: "rebase",
    phase: "conflicts",
    revision: "one",
    branch: "topic",
    commit: "a".repeat(40),
    progress: { current: 3, total: 8 },
    unresolvedPaths: ["file.txt"],
    lock: null,
    actions: [
      {
        action: "continue",
        enabled: false,
        reason: "Resolve and stage one file.",
      },
      { action: "skip", enabled: true, reason: null },
      { action: "abort", enabled: true, reason: null },
    ],
    ...patch,
  };
}
function snapshot(value = operation()): OperationRecoveryState {
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
    <NotificationsProvider>
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
    </NotificationsProvider>
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
    const merge = operation({
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
    await page.getByRole("button", { name: "Confirm abort" }).click();
    expect(f.execute).toHaveBeenCalledExactlyOnceWith("abort", "one");
  });

  it("invalidates an open confirmation when external Git state changes", async () => {
    const f = await fixture();
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Skip commit…" }).click();
    await f.view.rerender(f.tree(snapshot(operation({ revision: "two" }))));
    await expect
      .element(page.getByRole("button", { name: "Confirm skip" }))
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
      operation({
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

  it("keeps the operation visible when ordinary error notifications exceed the queue limit", async () => {
    await render(
      <NotificationsProvider>
        <ErrorNotification message="First error" />
        <ErrorNotification message="Second error" />
        <ErrorNotification message="Third error" />
        <ErrorNotification message="Fourth error" />
        <PersistentNotification>
          <OperationRecoveryToast
            state={snapshot()}
            repositoryName="catalog-api"
            writable
            execute={vi.fn()}
            review={vi.fn()}
            refresh={vi.fn()}
            dismiss={vi.fn()}
          />
        </PersistentNotification>
      </NotificationsProvider>,
    );
    await expect
      .element(page.getByRole("button", { name: "Review conflicts" }))
      .toBeVisible();
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
    f.set(operation());
    f.change("Refs");
    await expect
      .element(page.getByRole("button", { name: "Review conflicts" }))
      .toBeVisible();
    f.set(operation({ revision: "two", unresolvedPaths: ["a.txt", "b.txt"] }));
    f.change("Index");
    await expect
      .element(
        page.getByRole("heading", { name: "Rebase · 2 conflicts · 3/8" }),
      )
      .toBeVisible();
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("keeps a failed action visible when the next read finds the operation finished", async () => {
    const f = await liveFixture(readyToContinue());
    f.execute.mockImplementation(() => {
      f.set(idle());
      throw new EnvironmentHttpRejected({
        failure: {
          _tag: "OperationFailed",
          reason: "Uncertain",
          detail: "Git stopped responding.",
        },
      });
    });
    await page.getByRole("button", { name: "Continue rebase" }).click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Git stopped responding.");
    const reads = f.read.mock.calls.length;
    f.change("Refs");
    await expect.poll(() => f.read.mock.calls.length).toBeGreaterThan(reads);
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Git stopped responding.");
    await expect
      .element(page.getByRole("heading", { name: "Rebase completed" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Check again" }).click();
    await expect
      .element(page.getByRole("region", { name: "Git operation" }))
      .not.toBeInTheDocument();
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

    f.set(operation({ kind: "merge", progress: null }));
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
  return operation({
    phase: "ready",
    unresolvedPaths: [],
    actions: [{ action: "continue", enabled: true, reason: null }],
  });
}

function idle() {
  return operation({
    kind: "idle",
    phase: "idle",
    actions: [],
    unresolvedPaths: [],
    revision: "finished",
  });
}

async function liveFixture(initial: RepositoryOperation) {
  let current = initial;
  let gate = Promise.resolve();
  const listeners = new Set<EnvironmentChangeListener>();
  const read = vi.fn(async () => {
    await gate;
    return current;
  });
  const execute = vi.fn<(command: unknown) => RepositoryOperation>(
    () => current,
  );
  const requests = fakeRequests(
    respond(RepositoryOperationsHttpApi.read, async () => read()),
    respond(RepositoryOperationsHttpApi.execute, async (command) =>
      execute(command),
    ),
  );
  const changes = {
    subscribe: (listener: EnvironmentChangeListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const scope = repositoryScope({ repositoryId: "repo" });
  const tree = (connected: boolean) => (
    <EnvironmentProvider
      environment={{
        environmentId: "environment",
        requests,
        rpc: undefined,
        changes,
        connected,
        readable: true,
        writable: true,
      }}
    >
      <NotificationsProvider>
        <RepositoryScopeProvider scope={{ ...scope, connected }}>
          <WorkspacePanel.Provider scopeKey="operation-test">
            <OperationRecoveryNotice repositoryName="catalog-api" />
          </WorkspacePanel.Provider>
        </RepositoryScopeProvider>
      </NotificationsProvider>
    </EnvironmentProvider>
  );
  const view = await render(tree(true));
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
    connect: (connected: boolean) => view.rerender(tree(connected)),
    change: (kind: RepositoryChangeKind) => {
      for (const listener of listeners) listener(["repo"], kind);
    },
  };
}
