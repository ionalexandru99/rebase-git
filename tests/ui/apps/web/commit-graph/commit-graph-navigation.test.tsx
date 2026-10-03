import { act, createRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "#contracts/repository-history/repository-history.contract.ts";
import {
  CommitGraphFixture,
  history,
  historyOid,
  historyReader,
  mergeHistory,
  renderGraph,
} from "#tests-support/commit-graph-fixture.tsx";
import { waitForObservation } from "#tests-support/observation.ts";
import { render } from "#tests-support/render.tsx";
import type { CommitGraphHandle } from "#web/features/commit-graph/commit-graph.tsx";
import { saveRepositoryHistoryOrder } from "#web/features/repository-history/history-order.ts";
import type { HistoryQuery } from "#web/features/repository-history/history-worker-protocol.ts";

describe("commit graph navigation", () => {
  it("selects a loaded row in the same task as the arrow key", async () => {
    const reader = historyReader({ commits: history(20), status: "ready" });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    const target = grid.getByRole("row", { name: /^Commit 1,/ });
    await expect.element(target).toBeVisible();

    grid.element().focus();
    grid.element().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();

    expect(target.element().getAttribute("aria-selected")).toBe("true");
  });

  it("keeps a search result far below the first rows in view", async () => {
    const reader = historyReader({ commits: history(360), status: "ready" });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    await screen.getByRole("searchbox").fill("Commit 112");
    await screen.getByRole("button", { name: /Commit 112 Alex/ }).click();
    const target = grid.getByRole("row", { name: /^Commit 112,/ });
    await expect.element(target).toHaveAttribute("aria-selected", "true");
    await waitForObservation(() => {
      const bounds = grid.element().getBoundingClientRect();
      const row = target.element().getBoundingClientRect();
      expect(row.top).toBeGreaterThanOrEqual(bounds.top + 28);
      expect(row.bottom).toBeLessThanOrEqual(bounds.bottom);
    });
  });

  it("does not offer to expand a merge whose side is already revealed", async () => {
    const commits = mergeHistory().map((commit, index) =>
      index === 1
        ? { ...commit, parents: [historyOid(5), historyOid(2)] }
        : commit,
    );
    const reader = historyReader({ commits, status: "ready" });
    const screen = await renderGraph(reader);
    await screen.getByRole("button", { name: "Expand merge Commit 0" }).click();
    await expect
      .element(screen.getByRole("row", { name: /^Commit 2,/ }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Expand merge Commit 1" }))
      .not.toBeInTheDocument();
    await screen
      .getByRole("button", { name: "Collapse merge Commit 0" })
      .click();
    await expect
      .element(screen.getByRole("row", { name: /^Commit 2,/ }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Expand merge Commit 1" }))
      .toBeVisible();
  });

  it("adds the containing branch when opening a search result outside the filters", async () => {
    const commits = history(6);
    const main = { name: "main", type: "branch" as const, oid: historyOid(3) };
    const feature = {
      name: "feature/search",
      type: "branch" as const,
      oid: historyOid(0),
    };
    const reader = historyReader({ commits, status: "ready" });
    reader.publish({ refTargets: [main, feature] });
    function Workspace() {
      const [roots, setRoots] = useState<readonly RepositoryHistoryRefTarget[]>(
        [main],
      );
      return (
        <div style={{ height: 520, width: 900 }}>
          <CommitGraphFixture
            reader={reader}
            repositoryName="Search"
            roots={roots}
            scope={{
              _tag: "Custom",
              selections: roots.map((root) => ({
                _tag: "LocalBranch" as const,
                name: root.name,
              })),
            }}
            selections={roots.map((root) => ({
              _tag: "LocalBranch" as const,
              name: root.name,
            }))}
            onRevealHistoryRef={() => setRoots([main, feature])}
          />
        </div>
      );
    }
    const screen = await render(<Workspace />);
    await expect
      .element(screen.getByRole("row", { name: /^Commit 3,/ }))
      .toBeVisible();
    await screen
      .getByRole("searchbox", { name: "Search history" })
      .fill("Commit 1");
    await screen.getByRole("button", { name: /Commit 1 Alex/ }).click();
    await expect
      .element(
        screen
          .getByRole("button", { name: "Copy feature/search", exact: true })
          .first(),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("row", { name: /^Commit 1,/ }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("row", { name: /^Commit 1,/ }))
      .toBeVisible();
  });

  it("acknowledges expansion immediately and lets collapse supersede a pending read", async () => {
    const reader = historyReader({ commits: mergeHistory(), status: "ready" });
    const screen = await renderGraph(reader);
    const expand = screen.getByRole("button", {
      name: "Expand merge Commit 0",
    });
    await expect.element(expand).toBeVisible();
    const release = Promise.withResolvers<void>();
    reader.hold = release.promise;
    await expand.click();
    const collapse = screen.getByRole("button", {
      name: "Collapse merge Commit 0",
    });
    await expect.element(collapse).toBeVisible();
    const row = screen.getByRole("row", { name: /^Commit 0,/ });
    await expect.element(row).toHaveAttribute("aria-busy", "true");
    await collapse.click();
    await expect.element(expand).toBeVisible();
    await expect.element(row).not.toHaveAttribute("aria-busy", "true");
    reader.hold = undefined;
    await act(async () => release.resolve());
    await expect.element(expand).toBeVisible();
    await expect
      .element(screen.getByRole("row", { name: /^Commit 2,/ }))
      .not.toBeInTheDocument();
  });

  it("discards rows and selection when the cached history is cleared", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    const screen = await renderGraph(reader);
    await screen.getByRole("row", { name: /^Commit 0,/ }).click();
    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "true");
    await act(() => {
      reader.replace([]);
      reader.publish({ status: "empty", synchronization: "idle" });
    });
    await expect
      .element(screen.getByRole("status", { name: "Empty commit history" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .not.toBeInTheDocument();
    await act(() => {
      reader.replace(history(2));
      reader.publish({ status: "ready", synchronization: "complete" });
    });
    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "false");
  });

  it("moves the selection beyond the rows in view and retries a failed read", async () => {
    const reader = historyReader({ commits: history(1_000), status: "ready" });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    await expect.element(grid).toHaveAttribute("aria-rowcount", "1001");
    grid.element().focus();
    await userEvent.keyboard("{End}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 999,/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Home}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "true");
    const ask = reader.ask;
    let failures = 1;
    vi.spyOn(reader, "ask").mockImplementation((query, signal) =>
      query._tag === "Rows" && failures-- > 0
        ? Promise.reject({ _tag: "StorageUnavailable" })
        : ask(query, signal),
    );
    grid.element().scrollTop = 800 * 26;
    grid.element().dispatchEvent(new Event("scroll"));
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("This browser cannot store repository history.");
    await screen.getByRole("button", { name: "Retry" }).click();
    await expect
      .element(grid.getByRole("row", { name: /^Commit 801,/ }))
      .toBeVisible();
  });

  it("lets a row click supersede a pending direct navigation", async () => {
    const reader = historyReader({ commits: history(400), status: "ready" });
    const handle = createRef<CommitGraphHandle>();
    const screen = await render(
      <div style={{ height: 520, width: 900 }}>
        <CommitGraphFixture
          ref={handle}
          reader={reader}
          repositoryName="Pending jump"
          roots={[{ name: "main", type: "branch", oid: historyOid(0) }]}
        />
      </div>,
    );
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    const release = Promise.withResolvers<void>();
    reader.hold = release.promise;
    const jump = handle.current?.navigateToOid(historyOid(350));
    reader.hold = undefined;
    await grid.getByRole("row", { name: /^Commit 1,/ }).click();
    release.resolve();
    await jump;
    await expect
      .element(grid.getByRole("row", { name: /^Commit 1,/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 2,/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("jumps to a hidden nested line outside the first page and retains nested expansion after collapse", async () => {
    const commits = history(360).map((commit, index) => ({
      ...commit,
      parents:
        index === 0
          ? [historyOid(1), historyOid(250)]
          : index === 250
            ? [historyOid(251), historyOid(320)]
            : [100, 280, 359].includes(index)
              ? []
              : commit.parents,
    }));
    const reader = historyReader({ commits, status: "ready" });
    const handle = createRef<CommitGraphHandle>();
    const screen = await render(
      <div style={{ height: 520, width: 900 }}>
        <CommitGraphFixture
          ref={handle}
          reader={reader}
          repositoryName="Nested"
          roots={[{ name: "main", type: "branch", oid: historyOid(0) }]}
        />
      </div>,
    );
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    await screen.getByRole("searchbox").fill("Commit 350");
    await screen.getByRole("button", { name: /Commit 350 Alex/ }).click();
    await expect
      .element(grid.getByRole("row", { name: /^Commit 350,/ }))
      .toHaveAttribute("aria-selected", "true");
    await waitForObservation(() => {
      const bounds = grid.element().getBoundingClientRect();
      const target = grid
        .getByRole("row", { name: /^Commit 350,/ })
        .element()
        .getBoundingClientRect();
      expect(target.top).toBeGreaterThanOrEqual(bounds.top + 28);
      expect(target.bottom).toBeLessThanOrEqual(bounds.bottom);
    });
    grid.element().focus();
    await userEvent.keyboard("{Home}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    await screen
      .getByRole("button", { name: "Collapse merge Commit 0" })
      .click();
    await expect
      .element(screen.getByRole("button", { name: "Expand merge Commit 0" }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Expand merge Commit 0" }).click();
    await expect
      .poll(() => lastRows(reader.asked)?.scope.expanded)
      .toContainEqual({
        childOid: historyOid(250),
        parentOid: historyOid(320),
      });
    await handle.current?.navigateToOid(historyOid(350));
    await expect
      .element(grid.getByRole("row", { name: /^Commit 350,/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("reveals only the requested parent of an octopus merge when locating a commit", async () => {
    const commits = history(6).map((commit, index) => ({
      ...commit,
      parents:
        index === 0
          ? [historyOid(1), historyOid(3), historyOid(5)]
          : index === 2 || index === 4
            ? []
            : commit.parents,
    }));
    const reader = historyReader({ commits, status: "ready" });
    const handle = createRef<CommitGraphHandle>();
    const screen = await render(
      <div style={{ height: 520, width: 900 }}>
        <CommitGraphFixture
          ref={handle}
          reader={reader}
          repositoryName="Octopus"
          roots={[{ name: "main", type: "branch", oid: historyOid(0) }]}
        />
      </div>,
    );
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    await handle.current?.navigateToOid(historyOid(3));
    await expect
      .element(grid.getByRole("row", { name: /^Commit 3,/ }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 5,/ }))
      .not.toBeInTheDocument();
  });

  it("keeps active movement separate from ordered range and toggle selection", async () => {
    const screen = await renderGraph(
      historyReader({ commits: history(8), status: "ready" }),
    );
    const grid = screen.getByRole("grid");
    const row = (index: number) =>
      grid.getByRole("row", { name: new RegExp(`^Commit ${index},`) });
    await row(1).click();
    await userEvent.keyboard("{Shift>}");
    await row(4).click();
    await userEvent.keyboard("{/Shift}");
    for (const index of [1, 2, 3, 4])
      await expect.element(row(index)).toHaveAttribute("aria-selected", "true");
    expect(document.getSelection()?.toString()).toBe("");
    await userEvent.keyboard("{Control>}{ArrowDown}{/Control}");
    await expect
      .element(grid)
      .toHaveAttribute(
        "aria-activedescendant",
        `commit-${(5).toString(16).padStart(40, "0")}`,
      );
    await expect.element(row(5)).toHaveAttribute("aria-selected", "false");
    await userEvent.keyboard(" ");
    await expect.element(row(5)).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Escape}");
    expect(
      grid
        .getByRole("row")
        .all()
        .filter((row) => row.element().hasAttribute("aria-rowindex"))
        .every(
          (candidate) =>
            candidate.element().getAttribute("aria-selected") === "false",
        ),
    ).toBe(true);
    await expect.element(grid).toHaveFocus();
  });

  it("expands nested merge lines without selecting them and clears a selection hidden by collapse", async () => {
    const commits = mergeHistory();
    const merge = commits[0];
    const side = commits[2];
    const nested = commits[4];
    if (!merge || !side || !nested) throw new Error("Missing fixture");
    const reader = historyReader({ commits, status: "ready" });
    reader.publish({
      refTargets: [{ name: "nested-ref", oid: nested.oid, type: "tag" }],
    });
    const screen = await renderGraph(reader);
    await expect
      .element(screen.getByRole("row", { name: /^Commit 2,/ }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Expand merge Commit 0" }).click();
    await expect
      .element(screen.getByRole("row", { name: /^Commit 2,/ }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "false");
    await expect
      .element(screen.getByText("nested-ref"))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Expand merge Commit 2" }).click();
    await screen.getByRole("row", { name: /^Commit 4,/ }).click();
    await expect.element(screen.getByText("nested-ref")).toBeVisible();
    await screen
      .getByRole("button", { name: "Collapse merge Commit 0" })
      .click();
    await expect
      .element(screen.getByRole("row", { name: /^Commit 4,/ }))
      .not.toBeInTheDocument();
    expect(
      screen
        .getByRole("grid")
        .getByRole("row")
        .all()
        .filter((row) => row.element().hasAttribute("aria-rowindex"))
        .every(
          (row) => row.element().getAttribute("aria-selected") === "false",
        ),
    ).toBe(true);
    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(screen.getByRole("row", { name: /^Commit 4,/ }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Collapse merge Commit 2" }))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("does not reload history when merge keyboard expansion is unchanged", async () => {
    const reader = historyReader({ commits: mergeHistory(), status: "ready" });
    const screen = await renderGraph(reader);
    await screen.getByRole("row", { name: /^Commit 0,/ }).click();
    const rowReads = () =>
      reader.asked.filter((query) => query._tag === "Rows").length;
    const initialReads = rowReads();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(rowReads()).toBe(initialReads);

    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(screen.getByRole("row", { name: /^Commit 2,/ }))
      .toBeVisible();
    const expandedReads = rowReads();
    expect(expandedReads).toBe(initialReads + 1);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(rowReads()).toBe(expandedReads);
  });

  it("keeps scope-owned side lines visible without a redundant collapse control", async () => {
    const commits = mergeHistory();
    const reader = historyReader({ commits, status: "ready" });
    const screen = await renderGraph(reader, [
      { name: "main", oid: "0".repeat(40), type: "branch" },
      { name: "feature", oid: "2".padStart(40, "0"), type: "branch" },
    ]);
    await expect
      .element(screen.getByRole("row", { name: /^Commit 2,/ }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Expand merge Commit 0" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Expand merge Commit 2" }))
      .toBeVisible();
  });

  it("switches ordering locally while retaining selection and showing immediate feedback", async () => {
    const reader = historyReader({ commits: history(3), status: "ready" });
    const screen = await renderGraph(reader);
    const selected = screen.getByRole("row", { name: /^Commit 1,/ });
    await selected.click();
    const release = Promise.withResolvers<void>();
    reader.hold = release.promise;
    await act(() =>
      saveRepositoryHistoryOrder(
        {
          environmentId: "test-environment",
          repositoryId: "test-logical-repository",
        },
        "chronological",
      ),
    );
    await expect
      .element(screen.getByRole("grid"))
      .toHaveAttribute("aria-busy", "true");
    expect(lastRows(reader.asked)?.scope.order).toBe("chronological");
    reader.hold = undefined;
    release.resolve();
    await expect.element(selected).toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("grid"))
      .toHaveAttribute("aria-busy", "false");
  });

  it.each([7, 20 * 26 + 7])(
    "keeps the selected row and viewport anchored from scroll offset %i",
    async (scrollTop) => {
      const commits = history(100);
      const reader = historyReader({ commits, status: "ready" });
      const screen = await renderGraph(reader);
      const grid = screen.getByRole("grid", { name: "Commit history" });
      grid.element().scrollTop = scrollTop;
      grid.element().dispatchEvent(new Event("scroll"));
      const selectedIndex = Math.floor(scrollTop / 26) + 2;
      const selected = grid.getByRole("row", {
        name: new RegExp(`^Commit ${selectedIndex},`),
      });
      await expect.element(selected).toBeVisible();
      await selected.click();
      const release = Promise.withResolvers<void>();
      reader.hold = release.promise;

      await screen.rerender(
        <div style={{ height: 520, width: 900 }}>
          <CommitGraphFixture
            reader={reader}
            repositoryName="rebase-test"
            roots={[
              { name: "main", oid: "e".repeat(40), type: "branch" as const },
            ]}
          />
        </div>,
      );

      await expect.element(selected).toHaveAttribute("aria-selected", "true");
      expect(grid.element().scrollTop).toBe(scrollTop);
      reader.hold = undefined;
      await act(() => {
        reader.replace([
          {
            ...(commits[0] as RepositoryCommit),
            oid: "e".repeat(40),
            parents: [historyOid(0)],
            subject: "New tip",
          },
          ...commits,
        ]);
        release.resolve();
      });
      await expect
        .element(
          grid.getByRole("row", {
            name: new RegExp(`^Commit ${selectedIndex},`),
          }),
        )
        .toHaveAttribute("aria-selected", "true");
      await expect.poll(() => grid.element().scrollTop).toBe(scrollTop + 26);
    },
  );

  it("keeps stale history visible and offers a retry", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    reader.publish({ synchronization: "stale" });
    const screen = await renderGraph(reader);

    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Refresh history" }).click();
    expect(reader.synchronizations()).toBe(1);
  });
});

function lastRows(asked: readonly HistoryQuery[]) {
  return asked.findLast(
    (query): query is Extract<HistoryQuery, { _tag: "Rows" }> =>
      query._tag === "Rows",
  );
}
