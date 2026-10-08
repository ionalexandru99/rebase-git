import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  CommitInspectionApi,
  type InspectCommitDiff,
} from "#contracts/commit-inspection/commit-inspection.contract.ts";
import {
  FileBlameApi,
  type ReadFileBlame,
} from "#contracts/file-blame/file-blame.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import {
  blameCommit,
  changeDiff,
  changedFile,
  commitInspection,
  fileBlame,
  mainPath,
  repositoryRefs,
  repositoryScope,
  worktree,
} from "#tests-support/fixtures.ts";
import { historyOid } from "#tests-support/history.ts";
import { render } from "#tests-support/render.tsx";
import { useCommitInspection } from "#web/app/workspace/use-commit-inspection.ts";
import { CommitInspection } from "#web/features/commit-inspection/commit-inspection.tsx";
import { FileBlamePanel } from "#web/features/file-blame/file-blame-panel.tsx";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const scope = repositoryScope();
const tidied = blameCommit({
  oid: "1".repeat(40),
  subject: "Tidy the app",
  previous: { oid: "2".repeat(40), path: "lib/app.ts" },
});
const added = blameCommit({
  oid: "2".repeat(40),
  subject: "Add the app",
  path: "lib/app.ts",
});

function Workspace() {
  const { open } = useCommitInspection(true);
  return (
    <WorkspacePanel.Group>
      <WorkspacePanel.Sidebar />
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
          blame: (
            <RepositoryScopeProvider scope={scope}>
              <FileBlamePanel onOpenDetails={open} />
            </RepositoryScopeProvider>
          ),
        }}
      />
    </WorkspacePanel.Group>
  );
}

async function fixture() {
  const blames = vi.fn((_request: ReadFileBlame) =>
    fileBlame({
      text: "one\ntwo\nthree\nfour",
      ranges: [
        { start: 1, count: 2, oid: tidied.oid, originalLine: 1 },
        { start: 3, count: 1, oid: null, originalLine: 3 },
        { start: 4, count: 1, oid: added.oid, originalLine: 7 },
      ],
      commits: [tidied, added],
    }),
  );
  const diffs = vi.fn((command: InspectCommitDiff) => changeDiff(command.path));
  const requests = fakeRequests(
    respond(FileBlameApi.read, (request) => blames(request)),
    respond(CommitInspectionApi.inspect, (command) =>
      commitInspection({
        oid: command.oid,
        files:
          command.oid === added.oid
            ? [changedFile("README.md"), changedFile("lib/app.ts", "A")]
            : [changedFile("src/app.ts")],
      }),
    ),
    respond(CommitInspectionApi.inspectDiff, (command) => diffs(command)),
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
        <Workspace />
      </WorkspacePanel.Provider>
    </div>,
    { environment: { requests } },
  );
  return { screen, blames, diffs };
}

describe("file blame", () => {
  it("opens the introducing commit at its line and keeps the blamed range to come back to", async () => {
    const { screen, blames, diffs } = await fixture();
    await screen
      .getByRole("button", { name: "src/app.ts", exact: true })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Blame" }).click();

    const tab = screen.getByRole("tab", { name: "app.ts", exact: true });
    await expect.element(tab).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => blames.mock.calls.at(-1)?.[0])
      .toMatchObject({ path: "src/app.ts", revision: historyOid(0) });
    const introduced = screen.getByRole("option", { name: /Add the app/ });
    await introduced.click();
    await expect.element(introduced).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowUp}");
    await expect
      .element(screen.getByRole("option", { name: /Uncommitted/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}{Enter}");

    await expect
      .element(screen.getByRole("tab", { name: "Commit", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => diffs.mock.calls.at(-1)?.[0])
      .toMatchObject({ oid: added.oid, path: "lib/app.ts" });
    await tab.click();
    await expect.element(introduced).toHaveAttribute("aria-selected", "true");

    await screen
      .getByRole("option", { name: /Tidy the app/ })
      .click({ button: "right" });
    await screen
      .getByRole("menuitem", { name: "Blame before this commit" })
      .click();

    await expect
      .element(screen.getByRole("tab", { name: /^22222222\/app\.ts$/ }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => blames.mock.calls.at(-1)?.[0])
      .toMatchObject({ path: "lib/app.ts", revision: added.oid });
  });
});
