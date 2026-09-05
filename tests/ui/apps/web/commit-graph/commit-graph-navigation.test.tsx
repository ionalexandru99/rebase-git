import type { RepositoryCommit } from "@rebase/contracts";
import { act, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  CommitGraphFixture,
  history,
  historyOid,
  historyReader,
  mergeHistory,
  renderGraph,
} from "#tests-ui/apps/web/commit-graph/commit-graph-fixture";
import type { CommitGraphHandle } from "#web/features/commit-graph/commit-graph.contract";
import { RepositoryHistoryUnavailable } from "#web/features/repository-history/repository-history-reader.contract";
import { saveRepositoryHistoryOrder } from "#web/features/repository-settings/preferences/repository-history-order";

describe("commit graph navigation", () => {
  it.each([false, true])(
    "discards shared cache rows and selection without querying a closed reader (%s)",
    async (removed) => {
      const reader = historyReader({ commits: history(2), status: "ready" });
      reader.snapshot = { ...reader.snapshot, synchronization: "complete" };
      const screen = await renderGraph(reader);
      await screen.getByRole("row", { name: /^Commit 0,/ }).click();
      await expect.element(screen.getByText("1 selected")).toBeVisible();
      expect(reader.read).toHaveBeenCalledTimes(1);
      const reads = reader.read.mock.calls.length;
      if (removed) {
        reader.read.mockRejectedValue(new Error("Reader closed"));
        reader.locate.mockRejectedValue(new Error("Reader closed"));
        reader.locateMany.mockRejectedValue(new Error("Reader closed"));
      } else {
        reader.read.mockResolvedValue([]);
        reader.locateMany.mockResolvedValue([]);
      }
      reader.snapshot = {
        revision: 1,
        historyRevision: 1,
        status: "empty",
        synchronization: "idle",
        synchronizedCommitCount: 0,
      };
      await expect
        .element(screen.getByRole("status", { name: "Empty commit history" }))
        .toBeVisible();
      await expect.element(screen.getByText("0 selected")).toBeVisible();
      await expect
        .element(screen.getByRole("row", { name: /^Commit 0,/ }))
        .not.toBeInTheDocument();
      expect(reader.read).toHaveBeenCalledTimes(reads);
      if (!removed) {
        reader.read.mockResolvedValue(history(2));
        reader.snapshot = {
          revision: 2,
          historyRevision: 2,
          status: "ready",
          synchronization: "complete",
          synchronizedCommitCount: 2,
        };
        await expect
          .element(screen.getByRole("row", { name: /^Commit 0,/ }))
          .toBeVisible();
        await expect.element(screen.getByText("0 selected")).toBeVisible();
      }
    },
  );

  it("prefetches older pages, retains one keyboard move and retries without hiding loaded rows", async () => {
    const commits = history(230);
    const reader = historyReader({ commits, status: "ready" });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    let release: ((commits: readonly RepositoryCommit[]) => void) | undefined;
    reader.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    grid.element().scrollTop = 80 * 36;
    grid.element().dispatchEvent(new Event("scroll"));
    await vi.waitFor(() =>
      expect(reader.read).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 100, limit: 100 }),
      ),
    );
    grid.element().focus();
    await userEvent.keyboard("{End}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 99,/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 99,/ }))
      .toHaveAttribute("aria-selected", "true");
    release?.(commits.slice(100, 200));
    await expect
      .element(grid.getByRole("row", { name: /^Commit 100,/ }))
      .toHaveAttribute("aria-selected", "true");
    expect(
      reader.read.mock.calls.filter(([query]) => query.offset === 100),
    ).toHaveLength(1);
    reader.read.mockRejectedValueOnce(new Error("Older page failed"));
    grid.element().scrollTop = 180 * 36;
    grid.element().dispatchEvent(new Event("scroll"));
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Older page failed");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 180,/ }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Retry loading history" }).click();
    await expect.element(grid).toHaveAttribute("aria-rowcount", "230");
    grid.element().focus();
    await userEvent.keyboard("{End}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 229,/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Home}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("keeps a later pointer selection when a pending keyboard page arrives", async () => {
    const commits = history(130);
    const reader = historyReader({ commits, status: "ready" });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    let release: ((value: readonly RepositoryCommit[]) => void) | undefined;
    reader.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    grid.element().focus();
    await userEvent.keyboard("{End}{ArrowDown}");
    await vi.waitFor(() => expect(release).toBeDefined());
    await grid.getByRole("row", { name: /^Commit 98,/ }).click();
    release?.(commits.slice(100, 200));
    await expect.element(grid).toHaveAttribute("aria-rowcount", "130");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 98,/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowUp}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 97,/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it.each(["locate", "page"] as const)(
    "cancels an older direct navigation waiting on %s when a row is clicked",
    async (phase) => {
      const commits = history(400);
      const reader = historyReader({ commits, status: "ready" });
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
      let release: (() => void) | undefined;
      if (phase === "locate")
        reader.locate.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve(350);
            }),
        );
      else
        reader.read.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve(commits.slice(300));
            }),
        );
      const jump = handle.current?.navigateToOid(historyOid(350));
      await vi.waitFor(() => expect(release).toBeDefined());
      await grid.getByRole("row", { name: /^Commit 1,/ }).click();
      release?.();
      await jump;
      await expect
        .element(grid.getByRole("row", { name: /^Commit 1,/ }))
        .toHaveAttribute("aria-selected", "true");
      await userEvent.keyboard("{ArrowDown}");
      await expect
        .element(grid.getByRole("row", { name: /^Commit 2,/ }))
        .toHaveAttribute("aria-selected", "true");
    },
  );

  it("continues same-lane keyboard navigation across a pending page", async () => {
    const commits = history(130);
    const reader = historyReader({ commits, status: "ready" });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    let release: ((value: readonly RepositoryCommit[]) => void) | undefined;
    reader.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    grid.element().focus();
    await userEvent.keyboard("{End}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 99,/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Alt>}{ArrowDown}{ArrowDown}{/Alt}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 99,/ }))
      .toHaveAttribute("aria-selected", "true");
    release?.(commits.slice(100));
    await expect
      .element(grid.getByRole("row", { name: /^Commit 100,/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 99,/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("uses replicated named refs when their tips change without changing the caller roots", async () => {
    const commits = history(150);
    const reader = historyReader({ commits, status: "ready" });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    grid.element().scrollTop = 20 * 36 + 7;
    grid.element().dispatchEvent(new Event("scroll"));
    await grid.getByRole("row", { name: /^Commit 22,/ }).click();
    reader.getRefTargets.mockResolvedValue([
      { name: "main", type: "branch", oid: commits[10]?.oid ?? "" },
    ]);
    reader.snapshot = {
      revision: 1,
      historyRevision: 1,
      status: "ready",
      synchronization: "complete",
    };
    await vi.waitFor(() =>
      expect(reader.read).toHaveBeenLastCalledWith(
        expect.objectContaining({
          roots: [{ name: "main", type: "branch", oid: commits[10]?.oid }],
        }),
      ),
    );
    await expect
      .element(grid.getByRole("row", { name: /^Commit 22,/ }))
      .toHaveAttribute("aria-selected", "true");
    await vi.waitFor(() => expect(grid.element().scrollTop).toBe(10 * 36 + 7));
    const reads = reader.read.mock.calls.length;
    await act(async () => {
      reader.snapshot = { ...reader.snapshot, revision: 2 };
    });
    expect(reader.getRefTargets).toHaveBeenCalledTimes(2);
    expect(reader.read).toHaveBeenCalledTimes(reads);
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
    reader.ancestryRoute
      .mockResolvedValueOnce({
        edges: [{ childOid: historyOid(0), parentOid: historyOid(250) }],
        continuationOid: historyOid(250),
      })
      .mockResolvedValueOnce({
        edges: [{ childOid: historyOid(250), parentOid: historyOid(320) }],
      });
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
    await handle.current?.navigateToOid(historyOid(350));
    await expect
      .element(grid.getByRole("row", { name: /^Commit 350,/ }))
      .toHaveAttribute("aria-selected", "true");
    expect(reader.read).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 100 }),
    );
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
    await vi.waitFor(() =>
      expect(reader.read).toHaveBeenLastCalledWith(
        expect.objectContaining({
          additionalParentEdges: expect.arrayContaining([
            { childOid: historyOid(250), parentOid: historyOid(320) },
          ]),
        }),
      ),
    );
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
    reader.ancestryRoute.mockResolvedValue({
      edges: [{ childOid: historyOid(0), parentOid: historyOid(3) }],
    });
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
    reader.getRefTargets.mockResolvedValue([
      { name: "nested-ref", oid: nested.oid, type: "tag" },
    ]);
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
    const initialReads = reader.read.mock.calls.length;
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(reader.read).toHaveBeenCalledTimes(initialReads);

    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(screen.getByRole("row", { name: /^Commit 2,/ }))
      .toBeVisible();
    const expandedReads = reader.read.mock.calls.length;
    expect(expandedReads).toBe(initialReads + 1);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(reader.read).toHaveBeenCalledTimes(expandedReads);
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
    const commits = history(3);
    const reader = historyReader({ commits, status: "ready" });
    const screen = await renderGraph(reader);
    const selected = screen.getByRole("row", { name: /^Commit 1,/ });
    await selected.click();
    let finish: ((value: readonly RepositoryCommit[]) => void) | undefined;
    reader.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
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
    expect(reader.read).toHaveBeenLastCalledWith(
      expect.objectContaining({ order: "chronological" }),
    );
    finish?.(commits.toReversed());
    await expect.element(selected).toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("grid"))
      .toHaveAttribute("aria-busy", "false");
  });

  it.each([7, 20 * 36 + 7])(
    "keeps the selected row and viewport anchored from scroll offset %i",
    async (scrollTop) => {
      const commits = history(100);
      const firstCommit = commits[0];
      if (firstCommit === undefined) {
        throw new Error("Commit fixture is missing");
      }
      let finishReconciliation:
        | ((commits: readonly RepositoryCommit[]) => void)
        | undefined;
      const reconciliation = new Promise<readonly RepositoryCommit[]>(
        (resolve) => {
          finishReconciliation = resolve;
        },
      );
      const reader = historyReader({ commits, status: "ready" });
      reader.read
        .mockResolvedValueOnce(commits)
        .mockReturnValueOnce(reconciliation);
      const screen = await renderGraph(reader);
      const grid = screen.getByRole("grid", { name: "Commit history" });
      grid.element().scrollTop = scrollTop;
      grid.element().dispatchEvent(new Event("scroll"));
      const selectedIndex = Math.floor(scrollTop / 36) + 2;
      const selected = grid.getByRole("row", {
        name: new RegExp(`^Commit ${selectedIndex},`),
      });
      await expect.element(selected).toBeVisible();
      await selected.click();

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
      finishReconciliation?.([
        {
          ...firstCommit,
          oid: "e".repeat(40),
          parents: [firstCommit.oid],
          subject: "New tip",
        },
        ...commits.slice(0, 99),
      ]);
      await expect
        .element(
          grid.getByRole("row", {
            name: new RegExp(`^Commit ${selectedIndex},`),
          }),
        )
        .toHaveAttribute("aria-selected", "true");
      await vi.waitFor(() =>
        expect(grid.element().scrollTop).toBe(scrollTop + 36),
      );
    },
  );

  it("keeps stale history visible and offers a retry", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    reader.snapshot = {
      error: new RepositoryHistoryUnavailable(),
      revision: 2,
      historyRevision: 2,
      status: "ready",
      synchronization: "stale",
      synchronizedCommitCount: 2,
    };
    const screen = await renderGraph(reader);

    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Stale. Retry" }).click();
    expect(reader.read).toHaveBeenCalledTimes(2);
  });
});
