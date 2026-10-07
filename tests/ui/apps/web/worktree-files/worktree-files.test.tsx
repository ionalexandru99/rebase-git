import { describe, expect, it, vi } from "vite-plus/test";
import {
  type ReadChangeDiff,
  RepositoryChangesApi,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import { WorktreeFilesApi } from "#contracts/worktree-files/worktree-files.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import {
  changeDiff,
  changedFile,
  repositoryChanges,
  worktreeEntry,
  worktreeText,
} from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";

const folders: Record<string, ReturnType<typeof worktreeEntry>[]> = {
  "": [
    worktreeEntry("node_modules", "folder", true),
    worktreeEntry("src", "folder"),
    worktreeEntry("README.md"),
  ],
  src: [worktreeEntry("app.ts"), worktreeEntry("new.ts")],
};
const appSource = Array.from(
  { length: 120 },
  (_, index) => `export const line${index + 1} = ${index + 1};`,
).join("\n");

async function fixture() {
  const listed = vi.fn((folder: string) => folder);
  const read = vi.fn((path: string) => path);
  const diffs = vi.fn((command: ReadChangeDiff) => changeDiff(command.path));
  const requests = fakeRequests(
    respond(WorktreeFilesApi.list, ({ folder }) => {
      listed(folder);
      return { entries: folders[folder] ?? [], complete: true };
    }),
    respond(WorktreeFilesApi.read, ({ path }) => {
      read(path);
      return worktreeText(path === "src/app.ts" ? appSource : "# Readme\n");
    }),
    respond(WorktreeFilesApi.searchNames, () => ({
      paths: ["src/app.ts"],
      complete: true,
    })),
    respond(WorktreeFilesApi.searchText, ({ query }) => ({
      matches: [
        { path: "src/app.ts", line: 90, text: `export const ${query} = 90;` },
      ],
      complete: true,
    })),
    respond(RepositoryChangesApi.read, () =>
      repositoryChanges({
        unstaged: [changedFile("src/app.ts"), changedFile("src/new.ts", "?")],
      }),
    ),
    respond(RepositoryChangesApi.diff, (command) => diffs(command)),
  );
  const scopeKey = crypto.randomUUID();
  localStorage.setItem(
    `rebase:workspace-panel:v1:${scopeKey}`,
    JSON.stringify({ tabs: ["files"], active: "files", open: true }),
  );
  const repositoryId = crypto.randomUUID();
  const screen = await render(
    <div className="dark text-foreground" style={{ width: 1200, height: 650 }}>
      <WorkspacePanel.Sessions
        environment={{
          environmentId: "environment",
          connected: true,
          writable: true,
        }}
        repositoryIds={[repositoryId]}
      >
        <WorkspacePanel.Provider
          scopeKey={scopeKey}
          scope={{
            environmentId: "environment",
            logicalRepositoryId: repositoryId,
            repositoryId,
            worktreePath: "/repos/project",
          }}
        >
          <WorkspacePanel.Group>
            <WorkspacePanel.Sidebar />
            <WorkspacePanel.Main>{() => null}</WorkspacePanel.Main>
            <WorkspacePanel.Pane />
          </WorkspacePanel.Group>
        </WorkspacePanel.Provider>
      </WorkspacePanel.Sessions>
    </div>,
    { environment: { requests } },
  );
  const row = (path: string) =>
    screen.getByRole("treeitem", {
      name: path.replace(/\/$/, "").split("/").at(-1) ?? path,
      exact: true,
    });
  return { screen, listed, read, diffs, row };
}

describe("worktree files", () => {
  it("loads folders as they open, marks changes and opens a file as it is on disk", async () => {
    const { screen, listed, read, row } = await fixture();

    await expect.element(row("README.md")).toBeInTheDocument();
    expect(listed.mock.calls.map(([folder]) => folder)).toEqual([""]);
    await row("src/").click();
    await row("src/app.ts").click();

    await expect
      .element(screen.getByRole("heading", { name: "app.ts" }))
      .toBeInTheDocument();
    expect(listed.mock.calls.map(([folder]) => folder)).toEqual(["", "src"]);
    await expect
      .element(screen.getByText("export const line1 = 1;"))
      .toBeInTheDocument();
    expect(read).toHaveBeenLastCalledWith("src/app.ts");
  });

  it("opens a text match at its line and shows a changed file's diff from the menu", async () => {
    const { screen, read, diffs, row } = await fixture();

    await screen.getByRole("radio", { name: "Search text" }).click();
    await screen.getByRole("searchbox", { name: "Search text" }).fill("line90");
    await screen.getByRole("button", { name: "src/app.ts line 90" }).click();

    await expect
      .element(
        screen
          .getByRole("region", { name: "src/app.ts" })
          .getByText("export const line90 = 90;"),
      )
      .toBeInViewport();
    expect(read).toHaveBeenLastCalledWith("src/app.ts");

    await screen.getByRole("radio", { name: "Search file names" }).click();
    await screen.getByRole("searchbox", { name: "Search files" }).fill("");
    await row("src/new.ts").click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Show changes" }).click();

    await expect
      .element(screen.getByRole("tab", { name: "Diffs", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => diffs.mock.calls.at(-1)?.[0].path)
      .toBe("src/new.ts");
  });
});
