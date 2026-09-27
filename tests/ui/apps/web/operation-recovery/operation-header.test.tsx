import {
  type RepositoryChangeKind,
  type RepositoryChanges,
  RepositoryChangesApi,
  type RepositoryOperation,
  RepositoryOperationsApi,
} from "@rebase/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-ui/runtime/fake-requests";
import { render, testChanges } from "#tests-ui/runtime/render";
import { NotificationsProvider } from "#web/features/notifications/notifications";
import { OperationRecoveryNotice } from "#web/features/operation-recovery/components/operation-recovery-notice";
import { WorkingChanges } from "#web/features/working-changes/working-changes";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope";

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
    mergedBranch: null,
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
  const environmentChanges = testChanges();
  const execute = vi.fn(
    (_command: { readonly revision: string }): RepositoryOperation => operation,
  );
  const changes = (): RepositoryChanges => ({
    revision: operation.revision,
    head: "a".repeat(40),
    message: "",
    unstaged: [],
    staged: [],
    renamesLimited: false,
  });
  const requests = fakeRequests(
    respond(RepositoryOperationsApi.read, () => operation),
    respond(RepositoryOperationsApi.execute, (command) => execute(command)),
    respond(RepositoryChangesApi.read, () => changes()),
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
              openMergeView={() => {}}
            />
          </div>
        </WorkspacePanel.Provider>
      </RepositoryScopeProvider>
    </NotificationsProvider>,
    { environment: { requests }, queryClient: environmentChanges.queryClient },
  );
  return {
    execute,
    set: (next: RepositoryOperation) => {
      operation = next;
    },
    change: (kind: RepositoryChangeKind) => {
      environmentChanges.publish([scope.repositoryId], kind);
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

  it("keeps the toast while the Diffs panel is hidden", async () => {
    showPanel(false);
    await fixture();
    await expect
      .element(page.getByRole("region", { name: "Git operation" }))
      .toBeVisible();
  });

  it("continues once more with the fresh revision after a stale rejection", async () => {
    showPanel(true);
    const f = await fixture();
    f.set(ready());
    f.change("Index");
    f.execute
      .mockImplementationOnce(() => {
        f.set({ ...ready(), revision: "three" });
        throw rejected({
          _tag: "OperationFailed",
          reason: "Stale",
          detail: "Git state changed.",
        });
      })
      .mockImplementationOnce(() => {
        f.set(idle());
        return idle();
      });

    await header().getByRole("button", { name: "Continue rebase" }).click();

    await expect
      .element(page.getByRole("heading", { name: "Rebase completed" }))
      .toBeVisible();
    expect(f.execute.mock.calls.map(([command]) => command.revision)).toEqual([
      "two",
      "three",
    ]);
  });
});

function idle(): RepositoryOperation {
  return {
    ...ready(),
    kind: "idle",
    phase: "idle",
    revision: "finished",
    branch: null,
    commit: null,
    progress: null,
    actions: [],
  };
}
