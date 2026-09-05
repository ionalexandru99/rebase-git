import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  history,
  historyOid,
  historyReader,
  mergeHistory,
  renderGraph,
} from "#tests-ui/apps/web/commit-graph/commit-graph-fixture";
import { defaultKeyboardShortcutBindings } from "#web/features/keyboard-shortcuts/keyboard-shortcuts";

describe("commit graph commands", () => {
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
