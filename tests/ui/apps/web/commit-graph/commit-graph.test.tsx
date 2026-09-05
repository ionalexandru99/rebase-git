import type { RepositoryCommit } from "@rebase/contracts";
import { act, type ComponentProps, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { CommitGraphHandle } from "#web/features/commit-graph/commit-graph.contract";
import { defaultKeyboardShortcutBindings } from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import {
  type RepositoryHistoryQuery,
  type RepositoryHistoryReader,
  type RepositoryHistorySnapshot,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import { CommitGraph } from "#web-ui/features/commit-graph/commit-graph";

describe("commit graph", () => {
  it.each([
    [3, 100],
    [100, 3],
  ])(
    "keeps metadata aligned when history changes from %i to %i rows",
    async (before, after) => {
      const reader = historyReader({
        commits: history(before),
        status: "ready",
      });
      const screen = await renderGraph(reader);
      const grid = screen.getByRole("grid");
      const sha = grid
        .getByRole("row", { name: /^Commit 0,/ })
        .getByText(historyOid(0).slice(0, 8), { exact: true });
      await expect.element(sha).toBeVisible();
      expect(grid.element().scrollHeight > grid.element().clientHeight).toBe(
        before > 3,
      );
      reader.read.mockImplementation(async (query) =>
        history(after).slice(
          query.offset ?? 0,
          (query.offset ?? 0) + query.limit,
        ),
      );
      await screen
        .getByRole("combobox", { name: "History ordering" })
        .selectOptions("chronological");
      await vi.waitFor(() =>
        expect(grid.element().scrollHeight > grid.element().clientHeight).toBe(
          after > 3,
        ),
      );
      await vi.waitFor(() =>
        expect(
          Math.abs(
            screen
              .getByText("SHA", { exact: true })
              .element()
              .getBoundingClientRect().left -
              sha.element().getBoundingClientRect().left,
          ),
        ).toBeLessThan(1),
      );
    },
  );
  it.each([
    [1280, 720],
    [3440, 1440],
  ])(
    "keeps wide lanes and aligned metadata inside the %i by %i workspace",
    async (width, height) => {
      await page.viewport(width, height);
      const commits = history(129).map((commit, index) => ({
        ...commit,
        parents:
          index === 128 ? [] : [historyOid(index < 64 ? index + 64 : 128)],
      }));
      const roots = commits.slice(0, 64).map((commit, index) => ({
        name: `branch-${index}`,
        oid: commit.oid,
        type: "branch" as const,
      }));
      const reader = historyReader({ commits, status: "ready" });
      const screen = await render(
        <div style={{ height: height - 16, width: width - 312 }}>
          <CommitGraph
            reader={reader}
            repositoryName="wide-history"
            roots={roots}
          />
        </div>,
      );
      const grid = screen.getByRole("grid");
      await expect
        .element(grid.getByRole("row", { name: /^Commit 0,/ }))
        .toBeVisible();
      const element = grid.element();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      if (width === 1280)
        expect(element.scrollWidth).toBeGreaterThan(element.clientWidth);
      else expect(element.scrollWidth).toBe(element.clientWidth);
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event("scroll"));
      const sha = grid
        .getByRole("row", { name: /^Commit 0,/ })
        .getByText(historyOid(0).slice(0, 8), { exact: true });
      await expect.element(sha).toBeVisible();
      await vi.waitFor(() =>
        expect(
          Math.abs(
            screen
              .getByText("SHA", { exact: true })
              .element()
              .getBoundingClientRect().left -
              sha.element().getBoundingClientRect().left,
          ),
        ).toBeLessThan(1),
      );
      element.focus();
      await userEvent.keyboard("{ArrowDown}");
      await expect
        .element(grid.getByRole("row", { name: /^Commit 1,/ }))
        .toHaveAttribute("aria-selected", "true");
      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      await expect.element(screen.getByText("2 selected")).toBeVisible();
      await expect
        .element(screen.getByRole("status"))
        .not.toHaveTextContent("selected");
      expect(element.querySelectorAll("tr").length).toBeLessThan(60);
    },
  );

  it("opens cached search with the configured shortcut and reveals a hidden result", async () => {
    const commits = mergeHistory();
    const reader = historyReader({ commits, status: "ready" });
    reader.search.mockResolvedValue({
      commits: commits.slice(3, 4),
      replicaComplete: true,
      synchronizedCommitCount: 6,
    });
    reader.ancestryRoute.mockResolvedValue({
      edges: [{ childOid: historyOid(0), parentOid: historyOid(2) }],
    });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid");
    await expect
      .element(grid.getByRole("row", { name: /^Commit 0,/ }))
      .toBeVisible();
    grid.element().focus();
    await userEvent.keyboard("{Control>}f{/Control}");
    const search = screen.getByRole("searchbox", { name: "Search history" });
    await expect.element(search).toHaveFocus();
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

  it("uses one fetch handler from the toolbar and configured application shortcut", async () => {
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
    const screen = await renderGraph(reader, undefined, {
      commandEnvironment: {
        environmentId: "env",
        logicalRepositoryId: "logical",
        repositoryId: "repo",
        connected: true,
        capabilities: new Set(["repository.write"]),
        freshnessReady: true,
        operationState: "idle",
      },
      shortcuts: {
        platform: "other",
        bindings: {
          ...defaultKeyboardShortcutBindings,
          "graph.fetch": { key: "y", modifiers: ["Mod", "Shift"] },
        },
      },
    });
    const fetch = screen.getByRole("button", { name: "Fetch", exact: true });
    await expect
      .element(fetch)
      .toHaveAttribute("aria-keyshortcuts", "Control+Shift+y");
    await fetch.click();
    await vi.waitFor(() => expect(reader.fetch).toHaveBeenCalledOnce());
    await expect.element(fetch).toBeEnabled();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "y",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() => expect(reader.fetch).toHaveBeenCalledTimes(2));
  });

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

  it("opens cache recovery from the history menu and confirms the shared cache action", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    const changed = vi.fn();
    const screen = await renderGraph(reader, undefined, {
      onCacheChanged: changed,
    });
    const options = screen.getByRole("button", { name: "History options" });
    options.element().focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(screen.getByRole("menuitem", { name: "Fetch settings" }))
      .toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(options).toHaveFocus();
    await options.click();
    await screen.getByRole("menuitem", { name: "History storage" }).click();
    await screen
      .getByRole("button", { name: "Clear cache", exact: true })
      .click();
    await screen
      .getByRole("alertdialog")
      .getByRole("button", { name: "Clear cache", exact: true })
      .click();
    await vi.waitFor(() =>
      expect(reader.manageCache).toHaveBeenCalledWith("clear"),
    );
    expect(changed).toHaveBeenCalledWith("clear", {
      environmentId: "test-environment",
      repositoryId: "test-logical-repository",
    });
  });

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
          <CommitGraph
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
        <CommitGraph
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
    const label = screen.getByRole("button", { name: "Actions for main" });
    label.element().focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(screen.getByRole("menuitem", { name: "Remove from history" }))
      .toHaveFocus();
    await expect.element(label).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("grid")).toHaveFocus();
    await expect.element(label).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(screen.getByRole("row", { name: /^Commit 0,/ }))
      .toHaveAttribute("aria-selected", "true");
  });
  it("keeps overflow ref actions available without selecting their row", async () => {
    const reader = historyReader({ commits: history(3), status: "ready" });
    reader.getRefTargets.mockResolvedValue([
      { name: "main", oid: historyOid(0), type: "branch" },
      { name: "origin/main", oid: historyOid(0), type: "remote-branch" },
      { name: "release/long-tag-name", oid: historyOid(0), type: "tag" },
      { name: "topic/another-long-branch", oid: historyOid(0), type: "branch" },
    ]);
    const toggle = vi.fn();
    const screen = await renderGraph(reader, undefined, {
      onRemoveHistoryRef: toggle,
    });
    const row = screen.getByRole("row", { name: /^Commit 0,/ });
    await row.getByRole("button", { name: "2 more refs" }).click();
    await screen
      .getByRole("menuitem", { name: "release/long-tag-name Add to history" })
      .click();
    expect(toggle).toHaveBeenLastCalledWith(
      { _tag: "Tag", name: "release/long-tag-name" },
      expect.objectContaining({ selectedOids: [] }),
    );
    await expect.element(row).toHaveAttribute("aria-selected", "false");
    await expect.element(screen.getByRole("grid")).toHaveFocus();
    row.getByRole("button", { name: "2 more refs" }).element().focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect
      .element(
        screen.getByRole("menuitem", {
          name: "topic/another-long-branch Add to history",
        }),
      )
      .toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("grid")).toHaveFocus();
  });

  it("closes ref actions when scrolling replaces their commit and uses the new row metadata", async () => {
    const reader = historyReader({ commits: history(100), status: "ready" });
    reader.getRefTargets.mockResolvedValue([
      { name: "main", oid: historyOid(0), type: "branch" },
      { name: "older-label", oid: historyOid(1), type: "tag" },
      { name: "newer-label", oid: historyOid(61), type: "tag" },
    ]);
    const toggle = vi.fn();
    const screen = await renderGraph(reader, undefined, {
      onRemoveHistoryRef: toggle,
    });
    await screen
      .getByRole("button", { name: "Actions for older-label" })
      .click();
    await expect
      .element(screen.getByRole("menuitem", { name: "Add to history" }))
      .toBeVisible();
    const grid = screen.getByRole("grid");
    grid.element().scrollTop = 60 * 36;
    grid.element().dispatchEvent(new Event("scroll"));
    const row = grid.getByRole("row", { name: /^Commit 61,/ });
    await expect.element(row).toBeVisible();
    await expect
      .element(screen.getByRole("menuitem", { name: "Add to history" }))
      .not.toBeInTheDocument();
    await expect
      .element(
        row.getByRole("gridcell", { name: `Commit SHA ${historyOid(61)}` }),
      )
      .toBeVisible();
    await row.getByRole("button", { name: "Actions for newer-label" }).click();
    await screen.getByRole("menuitem", { name: "Add to history" }).click();
    expect(toggle).toHaveBeenLastCalledWith(
      { _tag: "Tag", name: "newer-label" },
      expect.objectContaining({ selectedOids: [] }),
    );
    await row.click();
    await expect.element(row).toHaveAttribute("aria-selected", "true");
    await expect
      .element(grid)
      .toHaveAttribute("aria-activedescendant", `commit-${historyOid(61)}`);
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
    const add = vi.fn();
    const reset = vi.fn();
    const selection = { _tag: "LocalBranch", name: "main" } as const;
    const screen = await render(
      <div style={{ height: 520, width: 900 }}>
        <CommitGraph
          onRemoveHistoryRef={remove}
          onAddHistoryRef={add}
          onResetHistoryScope={reset}
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
    await screen.getByRole("button", { name: "+ Add ref" }).click();
    expect(add).toHaveBeenCalledOnce();
    await screen.getByRole("button", { name: "Reset to Automatic" }).click();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("shows background synchronization without covering the graph", async () => {
    const reader = historyReader({ commits: history(2), status: "ready" });
    reader.snapshot = {
      revision: 1,
      historyRevision: 1,
      status: "ready",
      synchronization: "syncing",
      synchronizedCommitCount: 256,
      storingCommits: true,
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
      .element(screen.getByRole("status", { name: "Empty commit history" }))
      .toHaveTextContent("No cached commits in this history scope.");
    expect(reader.read).toHaveBeenCalledTimes(2);
  });

  it("shows an unborn repository without requesting Git history", async () => {
    const reader = historyReader({ commits: [], status: "empty" });
    const screen = await renderGraph(reader, []);

    await expect
      .element(screen.getByRole("status", { name: "Empty commit history" }))
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
  options: Pick<
    ComponentProps<typeof CommitGraph>,
    "onRemoveHistoryRef" | "onCacheChanged" | "commandEnvironment" | "shortcuts"
  > = {},
) {
  return render(
    <div style={{ height: 520, width: 900 }}>
      <CommitGraph
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
        {...options}
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
  let snapshot: RepositoryHistorySnapshot = {
    revision: 0,
    historyRevision: 0,
    status,
  };
  const listeners = new Set<() => void>();
  const matching = (query: RepositoryHistoryQuery) => {
    if (query.ancestry !== "first-parent") return commits;
    const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
    const visible = new Set<string>();
    const pending = query.roots.map((root) => root.oid);
    while (pending.length > 0) {
      const oid = pending.pop();
      if (oid === undefined || visible.has(oid)) continue;
      visible.add(oid);
      const commit = byOid.get(oid);
      if (commit === undefined) continue;
      pending.push(
        ...commit.parents.filter(
          (parentOid, index) =>
            index === 0 ||
            query.additionalParentEdges?.some(
              (edge) => edge.childOid === oid && edge.parentOid === parentOid,
            ),
        ),
      );
    }
    return commits.filter((commit) => visible.has(commit.oid));
  };

  const reader = {
    ancestryRoute: vi.fn<RepositoryHistoryReader["ancestryRoute"]>(
      async () => undefined,
    ),
    fetch: vi.fn<RepositoryHistoryReader["fetch"]>(),
    configureFetch: vi.fn<RepositoryHistoryReader["configureFetch"]>(),
    getCacheDiagnostics: async () => ({ caches: [], persistent: false }),
    manageCache: vi.fn<RepositoryHistoryReader["manageCache"]>(
      async () => undefined,
    ),
    search: vi.fn<RepositoryHistoryReader["search"]>(async () => ({
      commits: [],
      replicaComplete: true,
      synchronizedCommitCount: commits.length,
    })),
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
    close: vi.fn(),
    getCommitSummaries: vi.fn<RepositoryHistoryReader["getCommitSummaries"]>(
      async () => commits,
    ),
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
