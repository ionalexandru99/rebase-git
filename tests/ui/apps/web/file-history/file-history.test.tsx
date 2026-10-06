import { describe, expect, it, vi } from "vite-plus/test";
import {
  CommitInspectionApi,
  type InspectCommitDiff,
} from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { FileHistoryApi } from "#contracts/file-history/file-history.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import {
  changeDiff,
  changedFile,
  commitInspection,
  fileHistoryEntry,
  mainPath,
  repositoryRefs,
  repositoryScope,
  worktree,
} from "#tests-support/fixtures.ts";
import { historyOid } from "#tests-support/history.ts";
import { render } from "#tests-support/render.tsx";
import { ResizablePanel } from "#web/components/ui/resizable.tsx";
import { CommitInspection } from "#web/features/commit-inspection/commit-inspection.tsx";
import { FileHistoryPanel } from "#web/features/file-history/file-history-panel.tsx";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const scope = repositoryScope();
const histories: Record<string, ReturnType<typeof fileHistoryEntry>[]> = {
  "src/app.ts": [
    fileHistoryEntry({ oid: historyOid(0), subject: "Tidy the app" }),
    fileHistoryEntry({
      oid: historyOid(1),
      subject: "Move the app",
      status: "R",
      previousPath: "lib/app.ts",
    }),
    fileHistoryEntry({
      oid: historyOid(2),
      subject: "Add the app",
      path: "lib/app.ts",
      status: "A",
    }),
  ],
  "src/notes.md": [
    fileHistoryEntry({ oid: historyOid(0), path: "src/notes.md" }),
  ],
};

async function fixture() {
  const diffs = vi.fn((command: InspectCommitDiff) => changeDiff(command.path));
  const requests = fakeRequests(
    respond(CommitInspectionApi.inspect, (command) =>
      commitInspection({
        oid: command.oid,
        files: [changedFile("src/app.ts"), changedFile("src/notes.md")],
      }),
    ),
    respond(CommitInspectionApi.inspectDiff, (command) => diffs(command)),
    respond(FileHistoryApi.read, (command) => ({
      entries: histories[command.path] ?? [],
      complete: true,
    })),
    respond(RepositoryRefsApi.read, () =>
      repositoryRefs({ worktrees: [worktree(mainPath, "main")] }),
    ),
  );
  const scopeKey = crypto.randomUUID();
  localStorage.setItem(
    `rebase:workspace-panel:v1:${scopeKey}`,
    JSON.stringify({
      tabs: ["commit"],
      active: "commit",
      open: true,
      inputs: { commit: historyOid(0) },
    }),
  );
  const screen = await render(
    <div className="dark text-foreground" style={{ width: 1200, height: 650 }}>
      <WorkspacePanel.Provider scopeKey={scopeKey}>
        <WorkspacePanel.Group>
          <ResizablePanel id="graph" defaultSize="30%">
            Graph
          </ResizablePanel>
          <WorkspacePanel.Main>{() => null}</WorkspacePanel.Main>
          <WorkspacePanel.Pane
            contents={{
              commit: (
                <CommitInspection
                  scope={{
                    repositoryId: scope.repositoryId,
                    worktreePath: scope.worktreePath,
                  }}
                  connected
                  writable
                />
              ),
              history: (
                <RepositoryScopeProvider scope={scope}>
                  <FileHistoryPanel />
                </RepositoryScopeProvider>
              ),
            }}
          />
        </WorkspacePanel.Group>
      </WorkspacePanel.Provider>
    </div>,
    { environment: { requests } },
  );
  const openHistory = async (path: string) => {
    await screen.getByRole("tab", { name: "Commit", exact: true }).click();
    await screen
      .getByRole("button", { name: path, exact: true })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "File history" }).click();
  };
  return { screen, diffs, openHistory };
}

describe("file history", () => {
  it("opens a tab per file, follows renames into the diff and reuses an open tab", async () => {
    const { screen, diffs, openHistory } = await fixture();

    await openHistory("src/app.ts");
    const tab = screen.getByRole("tab", { name: "app.ts", exact: true });
    await expect.element(tab).toHaveAttribute("aria-selected", "true");
    await expect.element(tab).toHaveFocus();
    await expect.element(screen.getByText("3 commits in")).toBeInTheDocument();
    await screen.getByRole("option", { name: /Move the app/ }).click();
    await expect
      .poll(() => diffs.mock.calls.at(-1)?.[0])
      .toMatchObject({
        oid: historyOid(1),
        path: "src/app.ts",
        previousPath: "lib/app.ts",
      });

    await openHistory("src/notes.md");
    await expect
      .element(screen.getByRole("tab", { name: "notes.md", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await openHistory("src/app.ts");

    await expect
      .element(screen.getByRole("tab", { name: "app.ts", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    expect(
      screen
        .getByRole("tab")
        .elements()
        .map((tab) => tab.textContent),
    ).toEqual(["Commit", "app.ts", "notes.md"]);
  });
});
