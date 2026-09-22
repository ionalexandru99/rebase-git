import type { CommitInspection as Details } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import type { ChangeDiff } from "@rebase/contracts/repository-changes/repository-changes.contract";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CommitGraphFixture,
  history,
  historyOid,
  historyReader,
} from "#tests-ui/apps/web/commit-graph/commit-graph-fixture";
import type { CommitInspectionClient } from "#web/features/commit-inspection/commit-inspection.contract";
import { ResizablePanel } from "#web-ui/components/ui/resizable";
import { CommitInspectionSession } from "#web-ui/features/commit-inspection/commit-inspection-session";
import { CommitInspectionBridge } from "#web-ui/features/repository-workspace/commit-inspection-bridge";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";

function details(oid = historyOid(0), parentOid = historyOid(1)): Details {
  return {
    oid,
    parentOid,
    parents: [historyOid(1), historyOid(2)],
    message: `Message ${oid}\n\nFull body.`,
    author: {
      name: "Alex",
      email: "alex@example.test",
      date: "2026-09-15T10:00:00+03:00",
    },
    committer: {
      name: "Jamie",
      email: "jamie@example.test",
      date: "2026-09-15T11:00:00+03:00",
    },
    files: [
      { path: "src/first.bin", previousPath: null, status: "M" },
      { path: "src/second.bin", previousPath: "old.bin", status: "R" },
    ],
    truncated: false,
  };
}
function diff(path: string, bytes = 100): ChangeDiff {
  return {
    path,
    revision: path,
    kind: "binary",
    before: null,
    after: null,
    beforeBytes: 10,
    afterBytes: bytes,
    mime: null,
    patch: "",
  };
}
async function fixture(
  overrides: Partial<CommitInspectionClient> = {},
  saved?: object,
) {
  const client: CommitInspectionClient = {
    inspect: vi.fn((command) =>
      Effect.succeed(details(command.oid, command.parentOid)),
    ),
    diff: vi.fn((command) => Effect.succeed(diff(command.path))),
    ...overrides,
  };
  const reader = historyReader({ commits: history(40), status: "ready" });
  const scopeKey = crypto.randomUUID();
  if (saved)
    localStorage.setItem(
      `rebase:workspace-panel:v1:${scopeKey}`,
      JSON.stringify(saved),
    );
  const tree = (connected = true) => (
    <div className="dark text-foreground" style={{ width: 1200, height: 650 }}>
      <WorkspacePanel.Provider scopeKey={scopeKey}>
        <CommitInspectionBridge connected={connected}>
          {(inspection) => (
            <WorkspacePanel.Group>
              <ResizablePanel id="branches" defaultSize="15%" minSize="10%">
                Branches
              </ResizablePanel>
              <WorkspacePanel.Main>
                {() => (
                  <CommitGraphFixture
                    ref={inspection.graphRef}
                    reader={reader}
                    repositoryName="test"
                    roots={[
                      { type: "branch", name: "main", oid: historyOid(0) },
                    ]}
                    onOpenDetails={inspection.open}
                    onActiveCommitChange={inspection.select}
                    toolbarActions={<WorkspacePanel.Toggle />}
                    commandEnvironment={{
                      environmentId: "env",
                      repositoryId: "repo",
                      logicalRepositoryId: "logical",
                      connected: true,
                      capabilities: new Set(["repository.read"]),
                      operationState: "idle",
                      freshnessReady: true,
                    }}
                  />
                )}
              </WorkspacePanel.Main>
              <WorkspacePanel.Pane
                contents={{
                  commit: (
                    <CommitInspectionSession
                      client={client}
                      repositoryId="repository"
                      worktreePath="/repo"
                      connected={connected}
                    />
                  ),
                  changes: (
                    <input
                      aria-label="Working draft"
                      defaultValue="Keep this draft"
                    />
                  ),
                }}
              />
            </WorkspacePanel.Group>
          )}
        </CommitInspectionBridge>
      </WorkspacePanel.Provider>
    </div>
  );
  const screen = await render(tree());
  return {
    screen,
    client,
    grid: screen.getByRole("grid"),
    scopeKey,
    connect: (connected: boolean) => screen.rerender(tree(connected)),
  };
}

describe("commit inspection", () => {
  it("renders a root commit's text patch through the shared viewer", async () => {
    const { screen, grid } = await fixture({
      inspect: (command) =>
        Effect.succeed({
          ...details(command.oid),
          parentOid: null,
          parents: [],
          files: [{ path: "src/initial.ts", previousPath: null, status: "A" }],
        }),
      diff: (command) =>
        Effect.succeed({
          ...diff(command.path),
          kind: "text",
          before: null,
          after: "export const initial = true;\n",
          patch:
            '--- "src/initial.ts"\n+++ "src/initial.ts"\n@@ -0,0 +1,1 @@\n+export const initial = true;\n',
        }),
    });
    await grid.getByRole("row", { name: /^Commit 0,/ }).dblClick();
    await expect
      .poll(
        () =>
          document.querySelector("diffs-container")?.shadowRoot?.textContent,
        { timeout: 5_000 },
      )
      .toContain("export const initial = true;");
    await expect
      .element(
        screen.getByRole("button", { name: /Stage file|Discard lines|Amend/ }),
      )
      .not.toBeInTheDocument();
  });
  it("shows hidden unchanged lines on demand and omits the control for an added file", async () => {
    const { screen, grid } = await fixture({
      diff: (command) =>
        Effect.succeed({
          ...diff(command.path),
          kind: "text",
          before:
            command.path === "src/first.bin"
              ? "retained heading\nretained context\nold\n"
              : null,
          after:
            command.path === "src/first.bin"
              ? "retained heading\nretained context\nnew\n"
              : "added content\n",
          patch:
            command.path === "src/first.bin"
              ? "--- src/first.bin\n+++ src/first.bin\n@@ -3 +3 @@\n-old\n+new\n"
              : "--- src/second.bin\n+++ src/second.bin\n@@ -0,0 +1 @@\n+added content\n",
        }),
    });
    await grid.getByRole("row", { name: /^Commit 0,/ }).dblClick();
    const content = () =>
      screen
        .getByRole("region", { name: "Commit file diff" })
        .element()
        .querySelector("diffs-container")?.shadowRoot?.textContent;
    await expect.poll(content, { timeout: 5_000 }).toContain("new");
    await expect.poll(content).not.toContain("retained heading");
    await screen.getByRole("button", { name: "Show unchanged lines" }).click();
    await expect.poll(content).toContain("retained heading");
    await screen.getByRole("button", { name: "Hide unchanged lines" }).click();
    await expect.poll(content).not.toContain("retained heading");
    await screen.getByRole("button", { name: /second.bin/ }).click();
    await expect.poll(content).toContain("added content");
    await expect
      .element(screen.getByRole("button", { name: "Show unchanged lines" }))
      .not.toBeInTheDocument();
  });

  it("opens from a double click, follows selection, and closes with focus restored", async () => {
    const { screen, grid, client } = await fixture();
    const row = grid.getByRole("row", { name: /^Commit 0,/ });
    await row.dblClick();
    await expect
      .element(screen.getByRole("region", { name: "Commit details" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Full body.", { exact: false }))
      .toBeVisible();
    await expect.element(row).toBeVisible();
    await expect.element(row).toHaveAttribute("aria-selected", "true");
    await grid.getByRole("row", { name: /^Commit 1,/ }).click();
    await vi.waitFor(() =>
      expect(client.inspect).toHaveBeenLastCalledWith(
        expect.objectContaining({ oid: historyOid(1) }),
      ),
    );
    await screen.getByRole("button", { name: "Close Commit tab" }).click();
    await expect
      .element(screen.getByRole("region", { name: "Commit details" }))
      .not.toBeInTheDocument();
    await expect.element(grid).toHaveFocus();
    await expect
      .element(grid.getByRole("row", { name: /^Commit 1,/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("opens through the context menu and restores the prior tab and its state", async () => {
    const { screen, grid } = await fixture(
      {},
      { tabs: ["changes"], active: "changes", open: true, width: 40 },
    );
    await screen
      .getByRole("textbox", { name: "Working draft" })
      .fill("Unsaved selection state");
    await grid
      .getByRole("row", { name: /^Commit 0,/ })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Open details" }).click();
    await expect
      .element(screen.getByRole("tab", { name: "Commit", exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Close Commit tab" }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Working draft" }))
      .toHaveValue("Unsaved selection state");
    await expect.element(grid).toHaveFocus();
  });

  it("discards late metadata and file responses after selection changes", async () => {
    let completed = 0;
    let resolveDetails: (value: Details) => void = () => {};
    let resolveDiff: (value: ChangeDiff) => void = () => {};
    const pendingDetails = new Promise<Details>((resolve) => {
      resolveDetails = resolve;
    });
    const pendingDiff = new Promise<ChangeDiff>((resolve) => {
      resolveDiff = resolve;
    });
    const { screen, grid } = await fixture({
      inspect: (command) =>
        command.oid === historyOid(0)
          ? Effect.uninterruptible(
              Effect.promise(() => pendingDetails).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    completed++;
                  }),
                ),
              ),
            )
          : Effect.succeed(details(command.oid)),
      diff: (command) =>
        command.path === "src/first.bin"
          ? Effect.uninterruptible(
              Effect.promise(() => pendingDiff).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    completed++;
                  }),
                ),
              ),
            )
          : Effect.succeed(diff(command.path, 222)),
    });
    await grid.getByRole("row", { name: /^Commit 0,/ }).dblClick();
    await expect.element(screen.getByText("Loading commit…")).toBeVisible();
    await grid.getByRole("row", { name: /^Commit 1,/ }).click();
    await expect
      .element(screen.getByRole("button", { name: /second.bin/ }))
      .toBeVisible();
    await screen.getByRole("button", { name: /second.bin/ }).click();
    await expect.element(screen.getByText("10 → 222 bytes")).toBeVisible();
    resolveDetails(details());
    resolveDiff(diff("src/first.bin", 999));
    await vi.waitFor(() => {
      expect(completed).toBe(2);
      expect(
        screen.getByRole("region", { name: "Commit details" }).element()
          .textContent,
      ).toContain(`Message ${historyOid(1)}`);
      expect(
        screen.getByRole("region", { name: "Commit file diff" }).element()
          .textContent,
      ).toContain("10 → 222 bytes");
    });
    await expect
      .element(screen.getByText("10 → 999 bytes"))
      .not.toBeInTheDocument();
  });
});

it("preserves the restored inspector target across connection-driven graph notifications", async () => {
  const { screen, client, connect } = await fixture(
    {},
    {
      tabs: ["commit"],
      active: "commit",
      open: true,
      width: 40,
      inputs: { commit: historyOid(1) },
    },
  );
  await expect
    .element(screen.getByRole("button", { name: /second.bin/ }))
    .toBeVisible();
  await screen.getByRole("button", { name: /second.bin/ }).click();
  await connect(false);
  await connect(true);
  await expect
    .element(screen.getByRole("region", { name: "Commit details" }))
    .toHaveTextContent(`Message ${historyOid(1)}`);
  await expect
    .element(screen.getByRole("button", { name: /second.bin/ }))
    .toHaveAttribute("aria-pressed", "true");
  expect(client.inspect).toHaveBeenCalledTimes(1);
});
