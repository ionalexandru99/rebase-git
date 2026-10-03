import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  CommitGraphFixture,
  history,
  historyReader,
  mergeHistory,
  renderGraph,
} from "#tests-support/commit-graph-fixture.tsx";
import { repositoryScope } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import {
  type RepositoryScope,
  RepositoryScopeProvider,
} from "#web/platform/query/repository-scope.tsx";

describe("commit graph commands", () => {
  it("reveals a hidden result from cached search", async () => {
    const commits = mergeHistory();
    const reader = historyReader({ commits, status: "ready" });
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
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("offers creating refs at the commit on a writable connection", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    const screen = await render(
      <ScopedGraph reader={reader} scope={repositoryScope()} />,
    );
    await screen
      .getByRole("grid")
      .getByRole("row", { name: /^Commit 1,/ })
      .click({ button: "right" });
    await expect
      .element(screen.getByRole("menu"))
      .toHaveTextContent(
        "Create branch here…Create worktree here…Create tag here…Copy",
      );
    await userEvent.keyboard("{Escape}");

    await screen.rerender(
      <ScopedGraph
        reader={reader}
        scope={repositoryScope({ writable: false })}
      />,
    );
    await screen
      .getByRole("grid")
      .getByRole("row", { name: /^Commit 1,/ })
      .click({ button: "right" });
    await expect.element(screen.getByRole("menu")).toHaveTextContent("Copy");
    await expect
      .element(screen.getByRole("menuitem", { name: "Create tag here…" }))
      .not.toBeInTheDocument();
  });

  it("explains missing commit metadata and needs read access for details", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    const ask = reader.ask;
    vi.spyOn(reader, "ask").mockImplementation((query, signal) =>
      query._tag === "Commits"
        ? Promise.resolve([] as never)
        : ask(query, signal),
    );
    const openDetails = vi.fn();
    const screen = await render(
      <ScopedGraph
        reader={reader}
        scope={repositoryScope({ readable: false })}
        onOpenDetails={openDetails}
      />,
    );
    await screen
      .getByRole("grid")
      .getByRole("row", { name: /^Commit 1,/ })
      .click({ button: "right" });
    await expect
      .element(screen.getByRole("menuitem", { name: "Open details" }))
      .toHaveAttribute("aria-disabled", "true");
    await screen.getByRole("menuitem", { name: "Copy" }).click();
    await screen.getByRole("menuitem", { name: "Subject" }).click();
    await expect
      .element(screen.getByText("Commit metadata is not available yet."))
      .toBeVisible();
    expect(openDetails).not.toHaveBeenCalled();
  });

  it("selects the invoking commit and opens its menu from the keyboard", async () => {
    const commits = history(4);
    const reader = historyReader({ commits, status: "ready" });
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await grid.getByRole("row", { name: /^Commit 0,/ }).click();
    await grid
      .getByRole("row", { name: /^Commit 2,/ })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Copy" }).click();
    await screen.getByRole("menuitem", { name: "Subject" }).click();
    expect(copy).toHaveBeenLastCalledWith("Commit 2");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "false");
    await expect.element(grid).toHaveFocus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await screen.getByRole("menuitem", { name: "Copy" }).click();
    await screen.getByRole("menuitem", { name: "SHA" }).click();
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

function ScopedGraph({
  reader,
  scope,
  onOpenDetails,
}: {
  readonly reader: ReturnType<typeof historyReader>;
  readonly scope: RepositoryScope;
  readonly onOpenDetails?: (oid: string) => void;
}) {
  return (
    <div style={{ height: 520, width: 900 }}>
      <RepositoryScopeProvider scope={scope}>
        <CommitGraphFixture
          reader={reader}
          repositoryName="rebase-test"
          roots={[{ name: "main", oid: "0".repeat(40), type: "branch" }]}
          onOpenDetails={onOpenDetails}
        />
      </RepositoryScopeProvider>
    </div>
  );
}
