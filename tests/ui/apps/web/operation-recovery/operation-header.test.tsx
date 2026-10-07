import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type { RepositoryChangeKind } from "#contracts/environment-connection/environment-rpc.contract.ts";
import {
  type CommitChanges,
  RepositoryChangesApi,
} from "#contracts/repository-changes/repository-changes.contract.ts";
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
  changedFile,
  conflictedRebase,
  repositoryChanges,
  repositoryOperation,
  repositoryScope,
} from "#tests-support/fixtures.ts";
import { render, testChanges } from "#tests-support/render.tsx";
import { OperationRecoveryNotice } from "#web/features/operation-recovery/components/operation-recovery-toast.tsx";
import { WorkingChanges } from "#web/features/working-changes/working-changes.tsx";
import { PanelFeatureContext } from "#web/features/workspace-panel/api.ts";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const path = "src/app.ts";
const scope = repositoryScope({ repositoryId: crypto.randomUUID() });
const panelKey = "operation-header";
const panelFeature = {
  scope: { ...scope, environmentId: "local" },
  environment: undefined,
  active: true,
  input: undefined,
  expanded: false,
  expand: () => undefined,
  dispatch: () => undefined,
};

function conflicted(): RepositoryOperation {
  return conflictedRebase({ unresolvedPaths: [path] });
}

function ready(): RepositoryOperation {
  return conflictedRebase({
    phase: "ready",
    revision: "two",
    unresolvedPaths: [],
    actions: [
      { action: "continue", enabled: true, reason: null },
      { action: "abort", enabled: true, reason: null },
    ],
  });
}

function showPanel(open: boolean) {
  localStorage.setItem(
    `rebase:workspace-panel:v1:${panelKey}`,
    JSON.stringify({ tabs: ["changes"], active: "changes", open }),
  );
}

async function fixture() {
  let operation = conflicted();
  const environmentChanges = testChanges();
  let staged: string[] = [];
  const execute = vi.fn(
    (_command: { readonly revision: string }): RepositoryOperation => operation,
  );
  const commit = vi.fn((_command: CommitChanges) => undefined);
  const changes = () =>
    repositoryChanges({
      revision: operation.revision,
      unstaged: operation.unresolvedPaths.map((file) => changedFile(file, "U")),
      staged: staged.map((file) => changedFile(file, "A")),
    });
  const requests = fakeRequests(
    respond(RepositoryOperationsApi.read, () => operation),
    respond(RepositoryOperationsApi.execute, (command) => execute(command)),
    respond(RepositoryChangesApi.read, () => changes()),
    respond(RepositoryChangesApi.commit, (command) => {
      commit(command);
      staged = [];
      return { changes: changes(), diff: null };
    }),
  );
  await render(
    <RepositoryScopeProvider scope={scope}>
      <WorkspacePanel.Provider scopeKey={panelKey}>
        <OperationRecoveryNotice repositoryName="catalog-api" />
        <div
          className="dark text-foreground"
          style={{ width: 1100, height: 700 }}
        >
          <PanelFeatureContext.Provider value={panelFeature}>
            <WorkingChanges
              target={{
                repositoryId: scope.repositoryId,
                worktreePath: scope.worktreePath,
                draftKey: JSON.stringify([crypto.randomUUID()]),
                active: true,
              }}
              writable
            />
          </PanelFeatureContext.Provider>
        </div>
      </WorkspacePanel.Provider>
    </RepositoryScopeProvider>,
    { environment: { requests }, queryClient: environmentChanges.queryClient },
  );
  return {
    execute,
    commit,
    stage: (files: string[]) => {
      staged = files;
    },
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

  it("commits staged changes at a rebase edit stop but not during conflicts", async () => {
    showPanel(true);
    const f = await fixture();
    f.stage(["src/part.ts"]);
    f.change("Index");
    await page.getByLabelText("Commit subject").fill("First part");
    const commit = page.getByRole("button", { name: "Commit 1 file" });
    await expect.element(commit).toBeDisabled();

    f.set(editStop());
    f.change("Index");
    await expect.element(commit).toBeEnabled();
    await commit.click();
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ amend: false, message: "First part" }),
    );
  });

  it("keeps the toast while the Diffs panel is hidden", async () => {
    showPanel(false);
    await fixture();
    await expect
      .element(page.getByRole("region", { name: "Git operation" }))
      .toBeVisible();
  });

  it("skips a cherry-picked commit with nothing to commit in one click and leaves the resolved conflict", async () => {
    showPanel(true);
    const f = await fixture();
    await expect
      .element(page.getByRole("region", { name: "Conflict", exact: true }))
      .toBeVisible();
    f.set(nothingToCommit());
    f.change("Index");

    await expect
      .element(header().getByRole("heading"))
      .toHaveTextContent("Cherry-pick · Nothing to commit · 2/3");
    await expect
      .element(page.getByRole("region", { name: "Conflict", exact: true }))
      .not.toBeInTheDocument();
    await header().getByRole("button", { name: "Skip commit" }).click();

    expect(f.execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: "skip", revision: "empty" }),
    );
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

function editStop(): RepositoryOperation {
  return conflictedRebase({
    phase: "edit",
    revision: "edit",
    unresolvedPaths: [],
    actions: [
      { action: "continue", enabled: false, reason: null },
      { action: "abort", enabled: true, reason: null },
    ],
  });
}

function nothingToCommit(): RepositoryOperation {
  return repositoryOperation({
    kind: "cherry-pick",
    phase: "empty",
    revision: "empty",
    branch: "release",
    progress: { current: 2, total: 3 },
    actions: [
      { action: "continue", enabled: false, reason: "Nothing to commit." },
      { action: "skip", enabled: true, reason: null },
      { action: "abort", enabled: true, reason: null },
    ],
  });
}

function idle(): RepositoryOperation {
  return repositoryOperation({ revision: "finished" });
}
