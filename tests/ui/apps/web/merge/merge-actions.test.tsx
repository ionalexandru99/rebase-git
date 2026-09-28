import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type { RouteInput } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  type OperationStarted,
  RepositoryOperationsApi,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { CommitGraphFixture } from "#tests-support/commit-graph-fixture.tsx";
import {
  fakeRequests,
  idleOperation,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  mainPath,
  repositoryOperation,
  repositoryRefs,
  repositoryScope,
} from "#tests-support/fixtures.ts";
import {
  historyCommit as commit,
  type FakeRepositoryHistory,
  fakeRepositoryHistory,
  historyOid,
} from "#tests-support/history.ts";
import { render } from "#tests-support/render.tsx";
import { useMergeActions } from "#web/features/merge/merge-actions.ts";
import { NotificationsProvider } from "#web/features/notifications/notifications.tsx";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const topic = historyOid(1);
const main = historyOid(2);
const base = historyOid(3);
const commits = [
  commit(historyOid(0), [main], 0, "Ahead"),
  commit(topic, [base], 1, "Topic"),
  commit(main, [base], 2, "Main"),
  commit(base, [], 3, "Base"),
];
const refs = repositoryRefs({
  branches: [
    { name: "ahead", target: historyOid(0) },
    { name: "topic", target: topic },
    { name: "main", target: main, worktreePath: mainPath },
  ],
  worktrees: [
    { head: { branch: "main", commit: main }, main: true, path: mainPath },
  ],
});

type Start = RouteInput<typeof RepositoryOperationsApi.start>;

describe("merge actions", () => {
  it("merges a diverged branch from the graph menu with the keyboard", async () => {
    const started = vi.fn<(input: Start) => OperationStarted>(() => ({
      outcome: "Committed",
      operation: repositoryOperation(),
    }));
    const screen = await renderMerge(started);
    const grid = screen.getByRole("grid");
    await grid.getByRole("row", { name: /^Topic,/ }).click();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect
      .element(screen.getByRole("menuitem", { name: /^Merge into main/ }))
      .toBeVisible();
    await userEvent.keyboard("{ArrowDown}{ArrowRight}");
    await expect.element(screen.getByText("topic → main")).toBeVisible();
    await expect
      .element(screen.getByRole("menuitem", { name: /^Merge(?! into)/ }))
      .toHaveTextContent("merge commit");
    await expect
      .element(screen.getByRole("menuitem", { name: /^Fast-forward only/ }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("menuitem", { name: /^Squash/ }))
      .toHaveTextContent("1 commit");
    await expect
      .element(screen.getByRole("menuitem", { name: /^Merge(?! into)/ }))
      .toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => started.mock.calls.length).toBe(1);
    expect(started).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedHead: main,
        operation: {
          _tag: "Merge",
          source: { ref: "topic", commit: topic },
          mode: "merge",
        },
      }),
    );
  });

  it("names why a merge failed and opens Diffs after a squash", async () => {
    let outcome: "reject" | "stage" = "reject";
    const screen = await renderMerge(() => {
      if (outcome === "reject")
        throw rejected({
          _tag: "OperationFailed",
          reason: "WouldOverwrite",
          detail: "",
          paths: ["file.txt"],
        });
      return { outcome: "Staged", operation: repositoryOperation() };
    });
    const grid = screen.getByRole("grid");
    const openModes = async () => {
      await grid
        .getByRole("row", { name: /^Ahead,/ })
        .click({ button: "right" });
      await screen.getByRole("menuitem", { name: "Merge into main" }).click();
    };
    await openModes();
    const mergeMode = screen.getByRole("menuitem", { name: /^Merge(?! into)/ });
    await expect.element(mergeMode).toHaveTextContent("fast-forward");
    await mergeMode.click();
    await expect
      .element(screen.getByText("Local changes to file.txt block the merge."))
      .toBeVisible();
    await expect
      .element(screen.getByRole("status", { name: "Panel" }))
      .toHaveTextContent("closed");

    outcome = "stage";
    await openModes();
    await screen.getByRole("menuitem", { name: /^Squash/ }).click();
    await expect
      .element(screen.getByRole("status", { name: "Panel" }))
      .toHaveTextContent("changes");
  });

  it("leaves up-to-date sources and busy worktrees disabled with a reason", async () => {
    const screen = await renderMerge(() => {
      throw new Error("Unexpected merge");
    });
    await screen
      .getByRole("grid")
      .getByRole("row", { name: /^Base,/ })
      .click({ button: "right" });
    await expect
      .element(screen.getByRole("menuitem", { name: /^Merge into main/ }))
      .toHaveTextContent("Up to date");
    await expect
      .element(screen.getByRole("menuitem", { name: /^Merge into main/ }))
      .toHaveAttribute("aria-disabled", "true");
  });
});

async function renderMerge(started: (input: Start) => OperationStarted) {
  const history = fakeRepositoryHistory({ commits });
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryRefsApi.read, () => refs),
    respond(RepositoryOperationsApi.start, (input) => started(input)),
  );
  return render(
    <NotificationsProvider>
      <WorkspacePanel.Provider scopeKey={crypto.randomUUID()}>
        <RepositoryScopeProvider scope={repositoryScope()}>
          <div style={{ height: 420, width: 900 }}>
            <MergeGraph history={history} />
          </div>
          <PanelProbe />
        </RepositoryScopeProvider>
      </WorkspacePanel.Provider>
    </NotificationsProvider>,
    { environment: { requests } },
  );
}

function MergeGraph({ history }: { readonly history: FakeRepositoryHistory }) {
  const merge = useMergeActions(history);
  return (
    <CommitGraphFixture
      reader={history}
      merge={merge}
      repositoryName="rebase-test"
      roots={[
        { name: "ahead", oid: historyOid(0), type: "branch" },
        { name: "topic", oid: topic, type: "branch" },
      ]}
    />
  );
}

function PanelProbe() {
  const panel = useWorkspacePanel();
  return (
    <output aria-label="Panel">
      {panel.state.open ? panel.state.active : "closed"}
    </output>
  );
}
