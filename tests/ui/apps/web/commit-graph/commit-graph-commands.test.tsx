import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  CommitGraphFixture,
  history,
  historyOid,
  historyReader,
  mergeHistory,
  renderGraph,
} from "#tests-ui/apps/web/commit-graph/commit-graph-fixture";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import { render } from "#tests-ui/runtime/render";
import type { GraphCommandDefinition } from "#web/features/commit-commands/graph-command.contract";
import {
  type RepositoryScope,
  RepositoryScopeProvider,
} from "#web/features/repository-scope/repository-scope-provider";

describe("commit graph commands", () => {
  it("reveals a hidden result from cached search", async () => {
    const commits = mergeHistory();
    const reader = historyReader({ commits, status: "ready" });
    reader.search.mockResolvedValue({
      commits: commits.slice(3, 4),
      replicaComplete: true,
      synchronizedCommitCount: 6,
    });
    reader.ancestryRoute.mockResolvedValue({
      rootOid: historyOid(0),
      edges: [{ childOid: historyOid(0), parentOid: historyOid(2) }],
    });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    const search = screen.getByRole("searchbox", { name: "Search history" });
    await search.fill("Commit 3");
    await screen.getByRole("button", { name: /^Commit 3 Alex/ }).click();
    await expect
      .element(grid.getByRole("row", { name: /^Commit 3,/ }))
      .toHaveAttribute("aria-selected", "true");
    expect(reader.ancestryRoute).toHaveBeenCalledWith(
      [historyOid(0)],
      historyOid(3),
    );
  });

  it("fetches from the toolbar", async () => {
    const reader = readyToFetch();
    const screen = await render(
      <ScopedGraph reader={reader} scope={repositoryScope()} />,
    );
    const fetch = screen.getByRole("button", { name: "Fetch", exact: true });
    await fetch.click();
    await vi.waitFor(() => expect(reader.fetch).toHaveBeenCalledOnce());
    await expect.element(fetch).toBeEnabled();
  });

  it("runs commands that the workspace adds to the commit menu", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    const tagged = vi.fn<(oid: string) => void>();
    const tagCommand: GraphCommandDefinition = {
      id: "test.tag",
      order: 5,
      resolve: (context) => ({
        label: "Tag commit",
        enabled: context.writable,
        execute: async () => {
          tagged(context.invokingOid);
          return { _tag: "Executed" };
        },
      }),
    };
    const screen = await render(
      <ScopedGraph
        commands={[tagCommand]}
        reader={reader}
        scope={repositoryScope()}
      />,
    );
    await screen
      .getByRole("grid")
      .getByRole("row", { name: /^Commit 1,/ })
      .click({ button: "right" });
    await expect
      .element(screen.getByRole("menu"))
      .toHaveTextContent("Copy commit SHACopy commit subjectTag commit");
    await screen.getByRole("menuitem", { name: "Tag commit" }).click();
    expect(tagged).toHaveBeenCalledWith(historyOid(1));
  });

  it("selects the invoking commit and opens its menu from the keyboard", async () => {
    const commits = history(4);
    const reader = historyReader({ commits, status: "ready" });
    reader.getCommitSummaries.mockImplementation(async (oids) =>
      commits.filter(({ oid }) => oids.includes(oid)),
    );
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await grid.getByRole("row", { name: /^Commit 0,/ }).click();
    await grid
      .getByRole("row", { name: /^Commit 2,/ })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Copy commit subject" }).click();
    expect(copy).toHaveBeenLastCalledWith("Commit 2");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "false");
    await expect.element(grid).toHaveFocus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await screen.getByRole("menuitem", { name: "Copy commit SHA" }).click();
    expect(copy).toHaveBeenLastCalledWith(commits[2]?.oid);
    await userEvent.keyboard("{Control>}");
    await grid.getByRole("row", { name: /^Commit 0,/ }).click();
    await userEvent.keyboard("{/Control}");
    await grid
      .getByRole("row", { name: /^Commit 2,/ })
      .click({ button: "right" });
    await userEvent.keyboard("{Escape}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 2,/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Escape}");
    grid
      .element()
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
    copy.mockRestore();
  });
});

function readyToFetch() {
  const reader = historyReader({ commits: history(2), status: "ready" });
  const freshness = {
    revision: 0,
    fetching: false,
    stale: false,
    defaultIntervalSeconds: 300,
    setting: { _tag: "Inherit" as const },
  };
  reader.snapshot = { ...reader.snapshot, freshness };
  reader.fetch.mockResolvedValue(freshness);
  return reader;
}

function ScopedGraph({
  commands = [],
  reader,
  scope,
}: {
  readonly commands?: readonly GraphCommandDefinition[];
  readonly reader: ReturnType<typeof historyReader>;
  readonly scope: RepositoryScope;
}) {
  return (
    <div style={{ height: 520, width: 900 }}>
      <RepositoryScopeProvider scope={scope}>
        <CommitGraphFixture
          extraCommands={commands}
          reader={reader}
          repositoryName="rebase-test"
          roots={[{ name: "main", oid: "0".repeat(40), type: "branch" }]}
        />
      </RepositoryScopeProvider>
    </div>
  );
}
