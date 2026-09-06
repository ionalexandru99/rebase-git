import type { RepositoryCommit } from "@rebase/contracts";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  CommitGraphFixture,
  history,
  historyOid,
  historyReader,
  renderGraph,
} from "#tests-ui/apps/web/commit-graph/commit-graph-fixture";
import { graphRowHeight } from "#web/features/commit-graph/layout/graph-metrics";
import { RepositoryHistoryUnavailable } from "#web/features/repository-history/repository-history-reader.contract";
import { saveRepositoryHistoryOrder } from "#web/features/repository-settings/preferences/repository-history-order";

describe("commit graph states", () => {
  beforeEach(async () => {
    await page.viewport(1280, 720);
  });
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
      await act(() =>
        saveRepositoryHistoryOrder(
          {
            environmentId: "test-environment",
            repositoryId: "test-logical-repository",
          },
          "chronological",
        ),
      );
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
          <CommitGraphFixture
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
      expect(
        element.querySelectorAll("tr[aria-rowindex]").length,
      ).toBeLessThanOrEqual(
        Math.ceil(element.clientHeight / graphRowHeight) + 13,
      );
    },
  );

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
        <CommitGraphFixture
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
    expect(
      firstCommit.getByRole("button", { name: "Copy main", exact: true }).all(),
    ).toHaveLength(1);
    await expect.element(screen.getByText("hidden")).not.toBeInTheDocument();

    const removePill = screen.getByRole("button", {
      name: "Remove main from history",
    });
    const copyPill = screen
      .getByRole("group", { name: "Custom history scope" })
      .getByRole("button", { name: "Copy main", exact: true });
    expect(getComputedStyle(removePill.element()).opacity).toBe("0");
    const pill = copyPill.element().parentElement;
    if (pill === null) throw new Error("Missing pill");
    const bounds = pill.getBoundingClientRect();
    const addRef = screen.getByRole("button", { name: "+ Add ref" });
    const addBounds = addRef.element().getBoundingClientRect();
    await copyPill.hover();
    expect(getComputedStyle(removePill.element()).opacity).toBe("1");
    expect(
      removePill.element().getBoundingClientRect().right,
    ).toBeLessThanOrEqual(pill.getBoundingClientRect().right);
    expect(pill.getBoundingClientRect().width).toBe(bounds.width);
    expect(addRef.element().getBoundingClientRect().left).toBe(addBounds.left);
    await removePill.hover();
    expect(pill.getBoundingClientRect().width).toBe(bounds.width);
    expect(getComputedStyle(removePill.element()).opacity).toBe("1");
    await firstCommit.hover();
    expect(pill.getBoundingClientRect().width).toBe(bounds.width);
    expect(getComputedStyle(removePill.element()).opacity).toBe("0");
    copyPill.element().focus();
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(removePill.element());
    expect(getComputedStyle(removePill.element()).opacity).toBe("1");
    await userEvent.keyboard("{Enter}");
    expect(remove).toHaveBeenCalledWith(selection);
    await screen.getByRole("button", { name: "+ Add ref" }).click();
    expect(add).toHaveBeenCalledOnce();
    await screen.getByRole("button", { name: "Reset filters" }).click();
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

  it("renders 100 connected commits with bounded semantic rows and selection", async () => {
    const commits = history(100);
    const reader = historyReader({ commits, status: "ready" });
    const screen = await renderGraph(reader);
    const grid = screen.getByRole("grid", { name: "Commit history" });

    await expect.element(grid).toHaveAttribute("aria-rowcount", "101");
    await expect
      .element(grid.getByRole("row", { name: /Commit 0/ }))
      .toBeVisible();
    expect(grid.getByRole("row").all().length).toBeLessThan(40);
    expect(grid.getByRole("rowgroup").all()).toHaveLength(2);
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
        <CommitGraphFixture
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
        <CommitGraphFixture
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
