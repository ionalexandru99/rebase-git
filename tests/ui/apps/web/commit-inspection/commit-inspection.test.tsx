import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import {
  CommitInspectionApi,
  type CommitInspection as Details,
  type InspectCommit,
  type InspectCommitDiff,
  type PreviewRestore,
  type RestoreFiles,
  type RestoreOverwrites,
} from "#contracts/commit-inspection/commit-inspection.contract.ts";
import type { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";
import {
  CommitGraphFixture,
  history,
  historyOid,
  historyReader,
} from "#tests-support/commit-graph-fixture.tsx";
import {
  fakeRequests,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  changeDiff,
  changedFile,
  repositoryScope,
} from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { useCommitInspection } from "#web/app/workspace/use-commit-inspection.ts";
import { CommitInspection } from "#web/features/commit-inspection/commit-inspection.tsx";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

function Inspection({
  connected,
  children,
}: {
  readonly connected: boolean;
  readonly children: (
    inspection: ReturnType<typeof useCommitInspection>,
  ) => ReactNode;
}) {
  return children(useCommitInspection(connected));
}

interface InspectionClient {
  readonly inspect: (command: InspectCommit) => Details | Promise<Details>;
  readonly diff: (
    command: InspectCommitDiff,
  ) => ChangeDiff | Promise<ChangeDiff>;
}

const graphScope = repositoryScope({ writable: false });

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
      changedFile("src/first.bin"),
      changedFile("src/second.bin", "R", "old.bin"),
    ],
    truncated: false,
  };
}
function diff(path: string, bytes = 100) {
  return changeDiff(path, { afterBytes: bytes });
}
async function fixture(
  overrides: Partial<InspectionClient> = {},
  saved?: object,
) {
  const client = {
    inspect: vi.fn(
      overrides.inspect ??
        ((command: InspectCommit) => details(command.oid, command.parentOid)),
    ),
    diff: vi.fn(
      overrides.diff ?? ((command: InspectCommitDiff) => diff(command.path)),
    ),
  };
  const restores: RestoreFiles[] = [];
  const previews: PreviewRestore[] = [];
  const overwrites: RestoreOverwrites[] = [];
  const requests = fakeRequests(
    respond(CommitInspectionApi.inspect, (command) => client.inspect(command)),
    respond(CommitInspectionApi.inspectDiff, (command) => client.diff(command)),
    respond(CommitInspectionApi.previewRestore, (command) => {
      previews.push(command);
      return diff(command.path, 333);
    }),
    respond(CommitInspectionApi.restore, async (command) => {
      restores.push(command);
      const failure = overwrites.shift();
      if (failure !== undefined) throw rejected(failure);
    }),
  );
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
        <Inspection connected={connected}>
          {(inspection) => (
            <WorkspacePanel.Group>
              <WorkspacePanel.Sidebar>Branches</WorkspacePanel.Sidebar>
              <WorkspacePanel.Main>
                {() => (
                  <RepositoryScopeProvider scope={graphScope}>
                    <CommitGraphFixture
                      ref={inspection.graphRef}
                      reader={reader}
                      repositoryName="test"
                      roots={[
                        { type: "branch", name: "main", oid: historyOid(0) },
                      ]}
                      onOpenDetails={inspection.open}
                      onActiveCommitChange={inspection.select}
                      toolbarActions={<WorkspacePanel.Controls />}
                    />
                  </RepositoryScopeProvider>
                )}
              </WorkspacePanel.Main>
              <WorkspacePanel.Pane
                contents={{
                  commit: (
                    <CommitInspection
                      scope={{
                        repositoryId: "repository",
                        worktreePath: "/repo",
                      }}
                      connected={connected}
                      writable
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
        </Inspection>
      </WorkspacePanel.Provider>
    </div>
  );
  const screen = await render(tree(), { environment: { requests } });
  return {
    screen,
    client,
    restores,
    previews,
    overwrites,
    grid: screen.getByRole("grid"),
    scopeKey,
    connect: (connected: boolean) => screen.rerender(tree(connected)),
  };
}

describe("commit inspection", () => {
  it("renders a root commit's text patch through the shared viewer", async () => {
    const { screen, grid } = await fixture({
      inspect: (command) => ({
        ...details(command.oid),
        parentOid: null,
        parents: [],
        files: [changedFile("src/initial.ts", "A")],
      }),
      diff: (command) => ({
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
      )
      .toContain("export const initial = true;");
    await expect
      .element(
        screen.getByRole("button", {
          name: /^(Stage|Unstage|Discard) |Amend/,
        }),
      )
      .not.toBeInTheDocument();
  });
  it("shows hidden unchanged lines on demand and omits the control for an added file", async () => {
    const { screen, grid } = await fixture({
      diff: (command) => ({
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
    await expect.poll(content).toContain("new");
    await expect.poll(content).not.toContain("retained heading");
    const viewOptions = screen.getByRole("button", { name: "View options" });
    const unchanged = page.getByRole("menuitemcheckbox", {
      name: "Show unchanged lines",
    });
    await viewOptions.click();
    await unchanged.click();
    await expect.element(unchanged).toHaveAttribute("aria-checked", "true");
    await expect.poll(content).toContain("retained heading");
    await unchanged.click();
    await expect.poll(content).not.toContain("retained heading");
    await userEvent.keyboard("{Escape}");
    await screen.getByRole("button", { name: /second.bin/ }).click();
    await expect.poll(content).toContain("added content");
    await viewOptions.click();
    await expect
      .element(page.getByRole("menuitemcheckbox", { name: "Word wrap" }))
      .toBeVisible();
    await expect.element(unchanged).not.toBeInTheDocument();
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
    await expect
      .poll(() => client.inspect)
      .toHaveBeenLastCalledWith(
        expect.objectContaining({ oid: historyOid(1) }),
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
      { tabs: ["changes"], active: "changes", open: true },
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

  it("reads a renamed file's diff from its previous path", async () => {
    const { screen, grid, client } = await fixture();
    await grid.getByRole("row", { name: /^Commit 0,/ }).dblClick();
    await screen.getByRole("button", { name: /second.bin/ }).click();
    await expect
      .poll(() => client.diff)
      .toHaveBeenLastCalledWith(
        expect.objectContaining({
          path: "src/second.bin",
          previousPath: "old.bin",
        }),
      );
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
          ? pendingDetails.then((value) => {
              completed++;
              return value;
            })
          : details(command.oid),
      diff: (command) =>
        command.path === "src/first.bin"
          ? pendingDiff.then((value) => {
              completed++;
              return value;
            })
          : diff(command.path, 222),
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
    await expect.poll(() => completed).toBe(2);
    await expect
      .element(screen.getByRole("region", { name: "Commit details" }))
      .toHaveTextContent(`Message ${historyOid(1)}`);
    await expect
      .element(screen.getByRole("region", { name: "Commit file diff" }))
      .toHaveTextContent("10 → 222 bytes");
    await expect
      .element(screen.getByText("10 → 999 bytes"))
      .not.toBeInTheDocument();
  });
});

it("loads the file selected while disconnected when the connection resumes", async () => {
  const { screen, grid, client, connect } = await fixture();
  await grid.getByRole("row", { name: /^Commit 0,/ }).dblClick();
  await expect.poll(() => vi.mocked(client.diff).mock.calls.length).toBe(1);
  await connect(false);
  await screen.getByRole("button", { name: /second.bin/ }).click();
  expect(client.diff).toHaveBeenCalledTimes(1);
  await connect(true);
  await expect
    .poll(() => vi.mocked(client.diff).mock.calls.at(-1)?.[0].path)
    .toBe("src/second.bin");
  await expect
    .element(screen.getByRole("region", { name: "Commit file diff" }))
    .toHaveAttribute("aria-busy", "false");
});

it("preserves the restored inspector target across connection-driven graph notifications", async () => {
  const { screen, client, connect } = await fixture(
    {},
    {
      tabs: ["commit"],
      active: "commit",
      open: true,
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

describe("restoring files from a commit", () => {
  it("previews and restores the selected files from before the commit", async () => {
    const { screen, grid, previews, restores } = await fixture();
    await grid.getByRole("row", { name: /^Commit 0,/ }).dblClick();
    await screen.getByRole("button", { name: /first.bin/ }).click();
    await screen
      .getByRole("button", { name: /second.bin/ })
      .click({ modifiers: ["Control"] });
    await screen
      .getByRole("button", { name: /second.bin/ })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Restore" }).click();
    await screen.getByRole("menuitem", { name: "Before this commit" }).hover();
    await expect
      .element(screen.getByText("Working tree after restore"))
      .toBeVisible();
    expect(previews.at(-1)).toMatchObject({
      source: "parent",
      path: "src/second.bin",
      parentOid: historyOid(1),
    });
    await screen.getByRole("menuitem", { name: "Before this commit" }).click();
    await expect.poll(() => restores).toHaveLength(1);
    expect(restores[0]).toMatchObject({
      oid: historyOid(0),
      parentOid: historyOid(1),
      source: "parent",
      paths: ["src/first.bin", "src/second.bin", "old.bin"],
    });
    await expect
      .element(screen.getByText("Working tree after restore"))
      .not.toBeInTheDocument();
  });

  it("previews and restores the row right-clicked beside its name", async () => {
    const { screen, grid, previews, restores } = await fixture();
    await grid.getByRole("row", { name: /^Commit 0,/ }).dblClick();
    const second = screen.getByRole("button", { name: /second.bin/ });
    await expect.element(second).toBeVisible();
    const row = second.element().parentElement as HTMLElement;
    await userEvent.click(row, {
      button: "right",
      position: { x: row.clientWidth - 6, y: row.clientHeight / 2 },
    });
    await screen.getByRole("menuitem", { name: "Restore" }).click();
    await screen.getByRole("menuitem", { name: "Before this commit" }).hover();
    await expect.poll(() => previews.at(-1)?.path).toBe("src/second.bin");
    await screen.getByRole("menuitem", { name: "Before this commit" }).click();
    await expect.poll(() => restores).toHaveLength(1);
    expect(restores[0]?.paths).toEqual(["src/second.bin", "old.bin"]);
    await expect.element(second).toHaveAttribute("aria-pressed", "true");
  });

  it("restores exactly the highlighted rows after deselecting the open file", async () => {
    const { screen, grid, restores } = await fixture();
    await grid.getByRole("row", { name: /^Commit 0,/ }).dblClick();
    const first = screen.getByRole("button", { name: /first.bin/ });
    const second = screen.getByRole("button", { name: /second.bin/ });
    await second.click({ modifiers: ["Control"] });
    await first.click({ modifiers: ["Control"] });
    await expect.element(first).toHaveAttribute("aria-pressed", "false");
    await expect.element(second).toHaveAttribute("aria-pressed", "true");
    await second.click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Restore" }).click();
    await screen
      .getByRole("menuitem", { name: "This commit", exact: true })
      .click();
    await expect.poll(() => restores).toHaveLength(1);
    expect(restores[0]?.paths).toEqual(["src/second.bin", "old.bin"]);
  });

  it("asks before replacing uncommitted edits and sends the confirmed fingerprint", async () => {
    const { screen, grid, overwrites, restores } = await fixture();
    overwrites.push({
      _tag: "RestoreOverwrites",
      paths: ["src/first.bin"],
      count: 1,
      fingerprint: "f".repeat(64),
    });
    await grid.getByRole("row", { name: /^Commit 0,/ }).dblClick();
    (
      screen.getByRole("button", { name: /first.bin/ }).element() as HTMLElement
    ).focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await screen.getByRole("menuitem", { name: "Restore" }).click();
    await screen
      .getByRole("menuitem", { name: "This commit", exact: true })
      .click();
    const confirmation = screen.getByRole("alertdialog", {
      name: "Replace uncommitted edits in src/first.bin?",
    });
    await expect.element(confirmation).toBeVisible();
    await screen.getByRole("button", { name: "Replace and restore" }).click();
    await expect.element(confirmation).not.toBeInTheDocument();
    expect(restores).toEqual([
      expect.objectContaining({ source: "commit", paths: ["src/first.bin"] }),
      expect.objectContaining({
        source: "commit",
        paths: ["src/first.bin"],
        overwrite: "f".repeat(64),
      }),
    ]);
  });
});
