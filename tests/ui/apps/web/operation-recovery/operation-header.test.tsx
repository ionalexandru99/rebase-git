import {
  type RepositoryChangeKind,
  type RepositoryChanges,
  RepositoryChangesHttpApi,
  type RepositoryOperation,
  RepositoryOperationsHttpApi,
} from "@rebase/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import { fakeRequests, respond } from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import { NotificationsProvider } from "#web/features/notifications/notifications";
import { OperationRecoveryNotice } from "#web/features/operation-recovery/components/operation-recovery-notice";
import { RepositoryScopeProvider } from "#web/features/repository-scope/repository-scope-provider";
import { WorkingChanges } from "#web/features/working-changes/working-changes";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel";
import type { EnvironmentChangeListener } from "#web/platform/environment/environment-protocol.contract";

const path = "src/app.ts";
const scope = repositoryScope({ repositoryId: crypto.randomUUID() });
const panelKey = "operation-header";

function conflicted(): RepositoryOperation {
  return {
    kind: "rebase",
    phase: "conflicts",
    revision: "one",
    branch: "topic",
    commit: "a".repeat(40),
    progress: { current: 3, total: 8 },
    unresolvedPaths: [path],
    lock: null,
    actions: [
      { action: "continue", enabled: false, reason: "Resolve conflicts." },
      { action: "skip", enabled: true, reason: null },
      { action: "abort", enabled: true, reason: null },
    ],
  };
}

function ready(): RepositoryOperation {
  return {
    ...conflicted(),
    phase: "ready",
    revision: "two",
    unresolvedPaths: [],
    actions: [
      { action: "continue", enabled: true, reason: null },
      { action: "abort", enabled: true, reason: null },
    ],
  };
}

function showPanel(open: boolean) {
  localStorage.setItem(
    `rebase:workspace-panel:v1:${panelKey}`,
    JSON.stringify({ tabs: ["changes"], active: "changes", open, width: 40 }),
  );
}

async function fixture() {
  let operation = conflicted();
  const listeners = new Set<EnvironmentChangeListener>();
  const execute = vi.fn((command: { readonly action: string }) =>
    command.action === "abort"
      ? { ...operation, revision: "aborted" }
      : operation,
  );
  const changes = (): RepositoryChanges => ({
    revision: operation.revision,
    head: "a".repeat(40),
    message: "",
    unstaged: [],
    staged: [],
    truncated: false,
    renamesLimited: false,
  });
  const requests = fakeRequests(
    respond(RepositoryOperationsHttpApi.read, () => operation),
    respond(RepositoryOperationsHttpApi.execute, (command) => execute(command)),
    respond(RepositoryChangesHttpApi.read, () => changes()),
  );
  await render(
    <NotificationsProvider>
      <RepositoryScopeProvider scope={scope}>
        <WorkspacePanel.Provider scopeKey={panelKey}>
          <OperationRecoveryNotice repositoryName="catalog-api" />
          <div
            className="dark text-foreground"
            style={{ width: 1100, height: 700 }}
          >
            <WorkingChanges
              target={{
                repositoryId: scope.repositoryId,
                worktreePath: scope.worktreePath,
                draftKey: JSON.stringify([crypto.randomUUID()]),
                active: true,
              }}
              writable
            />
          </div>
        </WorkspacePanel.Provider>
      </RepositoryScopeProvider>
    </NotificationsProvider>,
    {
      environment: {
        requests,
        changes: {
          subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      },
    },
  );
  return {
    execute,
    set: (next: RepositoryOperation) => {
      operation = next;
    },
    change: (kind: RepositoryChangeKind) => {
      for (const listener of listeners) listener([scope.repositoryId], kind);
    },
  };
}

const header = () => page.getByRole("region", { name: "Operation" });

describe("operation header in the Diffs tab", () => {
  beforeEach(() => localStorage.clear());

  it("replaces the toast while the Diffs panel is visible", async () => {
    showPanel(true);
    const f = await fixture();
    await expect
      .element(
        header().getByRole("heading", { name: "Rebase · 1 conflict · 3/8" }),
      )
      .toBeVisible();
    await expect
      .element(header())
      .toHaveTextContent(`topic · ${"a".repeat(8)}`);
    await expect
      .element(header().getByRole("button", { name: "Continue rebase" }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("region", { name: "Git operation" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText("Use the operation toast", { exact: false }))
      .not.toBeInTheDocument();

    f.set(ready());
    f.change("Index");
    await expect
      .element(header().getByRole("button", { name: "Continue rebase" }))
      .toBeEnabled();
    await header().getByRole("button", { name: "Continue rebase" }).click();
    expect(f.execute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: "continue", revision: "two" }),
    );
  });

  it("asks before aborting from the header", async () => {
    showPanel(true);
    const f = await fixture();
    await header().getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Abort…" }).click();
    await expect
      .element(header().getByRole("button", { name: "Cancel", exact: true }))
      .toHaveFocus();
    expect(f.execute).not.toHaveBeenCalled();
    await header().getByRole("button", { name: "Confirm abort" }).click();
    expect(f.execute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: "abort", revision: "one" }),
    );
  });

  it("keeps the toast while the Diffs panel is hidden", async () => {
    showPanel(false);
    await fixture();
    await expect
      .element(page.getByRole("region", { name: "Git operation" }))
      .toBeVisible();
  });
});
