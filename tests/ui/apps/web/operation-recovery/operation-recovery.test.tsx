import {
  type RepositoryOperation,
  RepositoryOperationsHttpApi,
} from "@rebase/contracts";
import {
  type EnvironmentRequestClient,
  environmentHttpRoutesClient,
} from "@rebase/environment-client";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  ErrorNotification,
  NotificationsProvider,
  PersistentNotification,
} from "#web/features/notifications/index";
import { OperationRecovery } from "#web/features/operation-recovery/index";
import type { OperationRecoveryState } from "#web/features/operation-recovery/operation-recovery.contract";
import { RepositoryScopeProvider } from "#web/features/repository-scope/index";
import { OperationRecoveryToast } from "#web-ui/features/operation-recovery/components/operation-recovery-toast";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";

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

  it("rediscovers after reconnect and remount without repeating a mutation", async () => {
    let current = operation({
      phase: "ready",
      unresolvedPaths: [],
      actions: [{ action: "continue", enabled: true, reason: null }],
    });
    const read = vi.fn(() => current);
    const execute = vi.fn(() => current);
    const requests: EnvironmentRequestClient = (routes) =>
      environmentHttpRoutesClient(routes, (route) =>
        Effect.sync(() =>
          route.path === RepositoryOperationsHttpApi.read.path
            ? read()
            : execute(),
        ),
      );
    const { target } = repositoryScope({ repositoryId: "repo", requests });
    const tree = (connected: boolean, key = "first") => (
      <NotificationsProvider>
        <RepositoryScopeProvider
          scope={{ target, connected, readable: true, writable: true }}
        >
          <OperationRecovery.Provider key={key}>
            <WorkspacePanel.Provider scopeKey="operation-test">
              <OperationRecovery.Notice repositoryName="catalog-api" />
            </WorkspacePanel.Provider>
          </OperationRecovery.Provider>
        </RepositoryScopeProvider>
      </NotificationsProvider>
    );
    const view = await render(tree(true));
    await expect
      .element(page.getByRole("button", { name: "Continue rebase" }))
      .toBeEnabled();
    await view.rerender(tree(false));
    await expect
      .element(page.getByRole("button", { name: "Continue rebase" }))
      .toBeDisabled();
    current = operation({
      kind: "idle",
      phase: "idle",
      actions: [],
      unresolvedPaths: [],
      revision: "finished",
    });
    await view.rerender(tree(true));
    await expect
      .element(page.getByRole("region", { name: "Git operation" }))
      .not.toBeInTheDocument();
    current = operation();
    await view.rerender(tree(true, "restart"));
    await expect
      .element(page.getByRole("button", { name: "Review conflicts" }))
      .toBeVisible();
    expect(execute).not.toHaveBeenCalled();
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
