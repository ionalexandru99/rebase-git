import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  CompareApi,
  type CompareRevisions,
} from "#contracts/repository-comparison/compare-revisions.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import {
  changeDiff,
  changedFile,
  comparison,
  mainPath,
  repositoryRefs,
  repositoryScope,
  worktree,
} from "#tests-support/fixtures.ts";
import { historyOid } from "#tests-support/history.ts";
import { render } from "#tests-support/render.tsx";
import { ResizablePanel } from "#web/components/ui/resizable.tsx";
import { ComparisonPanel } from "#web/features/comparison/comparison-panel.tsx";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const main = historyOid(0);
const base = historyOid(1);
const first = historyOid(2);
const second = historyOid(3);
const moved = historyOid(4);

async function fixture(featureTip = second) {
  const tips = { compared: second };
  const compares = vi.fn((command: CompareRevisions) =>
    command.from._tag === "Commit" && command.to._tag === "Commit"
      ? comparison({
          from: command.from.oid,
          to: command.to.oid,
          base: command.from.oid,
          files: [changedFile("src/first.ts")],
        })
      : comparison({
          from: main,
          to: tips.compared,
          base,
          files: [changedFile("src/first.ts"), changedFile("src/second.ts")],
          commits: [
            { oid: second, parentOid: first, subject: "Second change" },
            { oid: first, parentOid: base, subject: "First change" },
          ],
        }),
  );
  const requests = fakeRequests(
    respond(CompareApi.compare, (command) => compares(command)),
    respond(CompareApi.diff, (command) => changeDiff(command.path)),
    respond(RepositoryRefsApi.read, () =>
      repositoryRefs({
        branches: [
          { name: "main", target: main },
          { name: "feature", target: featureTip },
        ],
        tags: [{ name: "v1", target: base }],
        worktrees: [worktree(mainPath, "main")],
      }),
    ),
  );
  const tab = "compare:LocalBranch/main...LocalBranch/feature";
  const scopeKey = crypto.randomUUID();
  localStorage.setItem(
    `rebase:workspace-panel:v1:${scopeKey}`,
    JSON.stringify({
      tabs: [tab],
      active: tab,
      open: true,
      inputs: {
        [tab]: {
          _tag: "Compare",
          from: { _tag: "LocalBranch", name: "main" },
          to: { _tag: "LocalBranch", name: "feature" },
        },
      },
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
              compare: (
                <RepositoryScopeProvider scope={repositoryScope()}>
                  <ComparisonPanel />
                </RepositoryScopeProvider>
              ),
            }}
          />
        </WorkspacePanel.Group>
      </WorkspacePanel.Provider>
    </div>,
    { environment: { requests } },
  );
  return { screen, compares, tips };
}

describe("comparison", () => {
  it("changes either side, swaps them and narrows to one commit", async () => {
    const { screen, compares } = await fixture();
    await expect
      .element(screen.getByRole("button", { name: "src/second.ts" }))
      .toBeInTheDocument();

    await screen.getByRole("button", { name: "Compare to feature" }).click();
    await page.getByRole("combobox", { name: "Compare to" }).fill("v1");
    await page.getByRole("option", { name: "v1" }).click();
    await expect
      .element(screen.getByRole("tab", { name: "v1", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await screen.getByRole("button", { name: "Swap sides" }).click();
    await expect
      .element(screen.getByRole("tab", { name: "main", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    expect(compares.mock.calls.at(-1)?.[0]).toMatchObject({
      from: { _tag: "Tag", name: "v1" },
      to: { _tag: "LocalBranch", name: "main" },
    });

    await screen.getByRole("button", { name: "First change" }).click();
    await expect
      .element(screen.getByRole("button", { name: "src/second.ts" }))
      .not.toBeInTheDocument();
    expect(compares.mock.calls.at(-1)?.[0]).toMatchObject({
      from: { _tag: "Commit", oid: base },
      to: { _tag: "Commit", oid: first },
    });
    await expect
      .element(screen.getByRole("button", { name: "First change" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the shown files until Refresh when a compared branch moves", async () => {
    const { screen, tips } = await fixture(moved);
    await expect
      .element(screen.getByRole("status").filter({ hasText: "feature moved" }))
      .toBeInTheDocument();

    tips.compared = moved;
    await screen.getByRole("button", { name: "Refresh" }).click();

    await expect
      .element(screen.getByText("feature moved"))
      .not.toBeInTheDocument();
  });
});
