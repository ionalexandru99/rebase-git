import type { RepositoryCommit } from "@rebase/contracts";
import { type ComponentProps, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { CommitGraphHandle } from "#web/features/commit-graph/commit-graph.contract";
import { visibleMergeTopology } from "#web/features/commit-graph/merge-visibility";
import { defaultKeyboardShortcutBindings } from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import {
  type RepositoryHistoryQuery,
  type RepositoryHistoryReader,
  type RepositoryHistorySnapshot,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import { CommitGraph } from "#web-ui/features/commit-graph/commit-graph";

describe("commit graph", () => {
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
    reader.snapshot = { ...reader.snapshot, revision: 2 };
    await vi.waitFor(() =>
      expect(reader.getRefTargets).toHaveBeenCalledTimes(3),
    );
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
        <CommitGraph
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

  it("uses the same history command from a ref label and the row keyboard menu", async () => {
    const commits = history(3);
    const reader = historyReader({ commits, status: "ready" });
    const roots = [
      { name: "main", oid: "0".repeat(40), type: "branch" as const },
    ];
    reader.getRefTargets.mockResolvedValue(roots);
    const toggle = vi.fn();
    const screen = await renderGraph(reader, roots, {
      onRemoveHistoryRef: toggle,
    });
    await screen.getByRole("button", { name: "Actions for main" }).click();
    await screen.getByRole("menuitem", { name: "Remove from history" }).click();
    expect(toggle).toHaveBeenLastCalledWith(
      { _tag: "LocalBranch", name: "main" },
      expect.objectContaining({ selectedOids: [] }),
    );
    await expect.element(screen.getByRole("grid")).toHaveFocus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await screen
      .getByRole("menuitem", { name: "Remove main from history" })
      .click();
    expect(toggle).toHaveBeenCalledTimes(2);
    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "true");
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
    await screen.getByRole("option", { name: /^Commit 0,/ }).click();
    const initialReads = reader.read.mock.calls.length;
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(reader.read).toHaveBeenCalledTimes(initialReads);

    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(screen.getByRole("option", { name: /^Commit 2,/ }))
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
    await screen
      .getByRole("combobox", { name: "History ordering" })
      .selectOptions("chronological");
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

  it("shows the editable scope and labels at their visible commit targets", async () => {
    const commits = history(3);
    const first = commits[0];
    if (first === undefined) throw new Error("Commit fixture is missing");
    const reader = historyReader({ commits, status: "ready" });
    reader.getRefTargets.mockResolvedValue([
      { name: "main", oid: first.oid, type: "branch" },
      {
        name: "origin/main",
        oid: first.oid,
        type: "remote-branch",
      },
      { name: "hidden", oid: "e".repeat(40), type: "tag" },
      { name: "HEAD", oid: first.oid, type: "head" },
    ]);
    const remove = vi.fn();
    const selection = { _tag: "LocalBranch", name: "main" } as const;
    const screen = await render(
      <div style={{ height: 520, width: 900 }}>
        <CommitGraph
          onRemoveHistoryRef={remove}
          reader={reader}
          repositoryName="rebase-test"
          roots={[{ name: "main", oid: first.oid, type: "branch" }]}
          scope={{ _tag: "Custom", selections: [selection] }}
          selections={[selection]}
        />
      </div>,
    );

    await expect
      .element(screen.getByRole("group", { name: "Custom history scope" }))
      .toBeVisible();
    const firstCommit = screen.getByRole("row", { name: /^Commit 0,/ });
    await expect
      .element(firstCommit.getByText("main", { exact: true }))
      .toBeVisible();
    await expect
      .element(firstCommit.getByText("origin/main", { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("hidden")).not.toBeInTheDocument();

    await screen
      .getByRole("button", { name: "Remove main from history" })
      .click();
    expect(remove).toHaveBeenCalledWith(selection);
  });

  it("shows background synchronization without covering the graph", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    reader.snapshot = {
      revision: 1,
      historyRevision: 1,
      status: "ready",
      synchronization: "syncing",
      synchronizedCommitCount: 256,
    };
    const screen = await renderGraph(reader);

    await expect.element(screen.getByText("Syncing")).toBeVisible();
    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
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
          <CommitGraph
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

  it("renders 100 connected commits with bounded semantic rows and selection", async () => {
    const commits = history(100);
    const reader = historyReader({ commits, status: "ready" });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid", { name: "Commit history" });

    await expect.element(grid).toHaveAttribute("aria-rowcount", "-1");
    await expect
      .element(grid.getByRole("row", { name: /Commit 0/ }))
      .toBeVisible();
    expect(grid.getByRole("row").all().length).toBeLessThan(40);
    await expect.element(grid.getByRole("rowgroup")).toBeInTheDocument();
    expect(document.querySelector("canvas")).not.toBeNull();

    const second = grid.getByRole("row", { name: /^Commit 1,/ });
    await second.click();
    await expect.element(second).toHaveAttribute("aria-selected", "true");
    grid.element().focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 2,/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("shows loading, empty, and failure states without hiding retry", async () => {
    let rejectLoad: ((error: unknown) => void) | undefined;
    const pending = new Promise<readonly RepositoryCommit[]>((_, reject) => {
      rejectLoad = reject;
    });
    const reader = historyReader({ commits: [], pending, status: "loading" });
    const screen = await renderGraph(reader);

    await expect
      .element(screen.getByRole("status", { name: "Loading commit history" }))
      .toBeVisible();
    reader.snapshot = {
      error: new RepositoryHistoryUnavailable(),
      revision: 1,
      historyRevision: 1,
      status: "error",
    };
    rejectLoad?.(new RepositoryHistoryUnavailable());
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Commit history is unavailable");

    reader.read.mockResolvedValue([]);
    await screen.getByRole("button", { name: "Retry" }).click();
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("This repository has no commits yet.");
    expect(reader.read).toHaveBeenCalledTimes(2);
  });

  it("shows an unborn repository without requesting Git history", async () => {
    const reader = historyReader({ commits: [], status: "empty" });
    const screen = await renderGraph(reader, []);

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("This repository has no commits yet.");
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("starts loading before the reader is available", async () => {
    const screen = await render(
      <div style={{ height: 520, width: 900 }}>
        <CommitGraph
          reader={undefined}
          repositoryName="rebase-test"
          roots={undefined}
        />
      </div>,
    );

    await expect
      .element(screen.getByRole("status", { name: "Loading commit history" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("This repository has no commits yet."))
      .not.toBeInTheDocument();
  });

  it("removes the previous repository rows before a replacement read fails", async () => {
    const first = historyReader({ commits: history(2), status: "ready" });
    const screen = await renderGraph(first);
    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    let rejectRead: ((error: unknown) => void) | undefined;
    const pending = new Promise<readonly RepositoryCommit[]>((_, reject) => {
      rejectRead = reject;
    });
    const second = historyReader({ commits: [], pending, status: "loading" });

    await screen.rerender(
      <div style={{ height: 520, width: 900 }}>
        <CommitGraph
          reader={second}
          repositoryName="replacement"
          roots={[
            { name: "main", oid: "e".repeat(40), type: "branch" as const },
          ]}
        />
      </div>,
    );
    second.snapshot = {
      error: new RepositoryHistoryUnavailable(),
      revision: 1,
      historyRevision: 1,
      status: "error",
    };
    rejectRead?.(new RepositoryHistoryUnavailable());

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Commit history is unavailable");
    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .not.toBeInTheDocument();
  });
});

async function renderGraph(
  reader: ReturnType<typeof historyReader>,
  roots = [{ name: "main", oid: "0".repeat(40), type: "branch" as const }],
  options: Pick<ComponentProps<typeof CommitGraph>, "onRemoveHistoryRef"> = {},
) {
  return render(
    <div style={{ height: 520, width: 900 }}>
      <CommitGraph
        {...options}
        reader={reader}
        repositoryName="rebase-test"
        roots={roots}
        commandEnvironment={{
          environmentId: "test-environment",
          logicalRepositoryId: "test-logical-repository",
          repositoryId: "test-repository",
          activeBranch: "main",
          activeWorktreePath: "/repo",
          capabilities: new Set(),
          connected: false,
          freshnessReady: false,
          operationState: "idle",
        }}
        shortcuts={{
          bindings: defaultKeyboardShortcutBindings,
          platform: "other",
        }}
      />
    </div>,
  );
}

function mergeHistory() {
  const commits = history(6);
  const parents = [[1, 2], [5], [3, 4], [5], [5], []];
  return commits.map((commit, index) => ({
    ...commit,
    parents: (parents[index] ?? []).map((parent) =>
      parent.toString(16).padStart(40, "0"),
    ),
  }));
}

function historyReader({
  commits,
  pending,
  status,
}: {
  readonly commits: readonly RepositoryCommit[];
  readonly pending?: Promise<readonly RepositoryCommit[]>;
  readonly status: "empty" | "loading" | "ready";
}) {
  let snapshot: RepositoryHistorySnapshot = { revision: 0, historyRevision: 0, status };
  const listeners = new Set<() => void>();
  const matching = (query: RepositoryHistoryQuery) =>
    query.ancestry === "first-parent"
      ? visibleMergeTopology(
          commits,
          query.roots.map((root) => root.oid),
          new Set(
            (query.additionalParentEdges ?? []).map((edge) => edge.childOid),
          ),
        ).commits
      : commits;

  const reader = {
    ancestryRoute: vi.fn<RepositoryHistoryReader["ancestryRoute"]>(
      async () => undefined,
    ),
    locate: vi.fn<RepositoryHistoryReader["locate"]>(async (query, oid) => {
      const index = matching(query).findIndex((commit) => commit.oid === oid);
      return index < 0 ? undefined : index;
    }),
    locateMany: vi.fn<RepositoryHistoryReader["locateMany"]>(
      async (query, oids) =>
        matching(query).flatMap((commit, index) =>
          oids.includes(commit.oid) ? [{ oid: commit.oid, index }] : [],
        ),
    ),
    fetch: vi.fn<RepositoryHistoryReader["fetch"]>(),
    configureFetch: vi.fn<RepositoryHistoryReader["configureFetch"]>(),

    close: vi.fn(),
    getCommitSummaries: vi.fn<RepositoryHistoryReader["getCommitSummaries"]>(async () => commits),
    getCacheDiagnostics: async () => ({ caches: [], persistent: false }),
    manageCache: async () => undefined,
    search: async () => ({
      commits: [],
      replicaComplete: true,
      synchronizedCommitCount: commits.length,
    }),

    getRefTargets: vi.fn<RepositoryHistoryReader["getRefTargets"]>(
      async () => [],
    ),
    getSnapshot: (): RepositoryHistorySnapshot => snapshot,
    read: vi.fn<RepositoryHistoryReader["read"]>(
      (query) =>
        pending ??
        Promise.resolve(
          matching(query).slice(
            query.offset ?? 0,
            (query.offset ?? 0) + query.limit,
          ),
        ),
    ),
    get snapshot() {
      return snapshot;
    },
    set snapshot(value: RepositoryHistorySnapshot) {
      snapshot = value;
      for (const listener of listeners) listener();
    },
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  } satisfies RepositoryHistoryReader & {
    snapshot: RepositoryHistorySnapshot;
  };
  return reader;
}

function history(count: number): readonly RepositoryCommit[] {
  return Array.from({ length: count }, (_, index) => ({
    author: identity(index),
    committer: identity(index),
    oid: index.toString(16).padStart(40, "0"),
    parents:
      index === count - 1 ? [] : [(index + 1).toString(16).padStart(40, "0")],
    subject: `Commit ${index}`,
  }));
}

function historyOid(index: number) {
  return index.toString(16).padStart(40, "0");
}

function identity(index: number) {
  return {
    email: "alex@example.test",
    name: "Alex I.",
    timestampSeconds: 1_777_777_777 - index,
    timezoneOffsetMinutes: 120,
  };
}
