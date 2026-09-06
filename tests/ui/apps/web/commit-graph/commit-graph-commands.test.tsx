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
      rootOid: historyOid(0),
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
