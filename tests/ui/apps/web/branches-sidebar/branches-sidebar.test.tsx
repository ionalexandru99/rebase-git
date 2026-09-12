import type { RepositoryRefs, RepositoryRefTarget } from "@rebase/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { historyRefKey } from "#web/features/commit-graph/scope/history-scope";
import {
  RepositoryRefsBusy,
  type RepositoryRefsSnapshot,
  RepositoryRefsUnavailable,
} from "#web/features/repository-refs/repository-refs-controller.contract";
import { BranchesSidebar } from "#web-ui/features/branches-sidebar/branches-sidebar";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const mainPath = "/repo";
const topicPath = "/repo/.worktrees/topic";
const commit = "a".repeat(40);
describe("branches sidebar", () => {
  beforeEach(() => localStorage.removeItem("rebase:branches-view:v1"));

  it("reveals linked worktree icons on hover and keyboard focus", async () => {
    const { screen } = await renderSidebar();
    const tree = screen.getByRole("tree", { name: "Branches" });
    const main = tree.getByRole("treeitem", { name: "main, current branch" });
    const topic = tree.getByRole("treeitem", {
      name: "topic, linked worktree",
    });
    const marker = topic.getByRole("img", { name: "Linked worktree" });
    await expect.element(main).toHaveAttribute("aria-current", "true");
    await expect
      .element(main.getByRole("img", { name: "Linked worktree" }))
      .not.toBeInTheDocument();
    await expect.element(marker).toHaveStyle({ opacity: "0" });
    await topic.hover();
    await expect.element(marker).toHaveStyle({ opacity: "1" });
    await main.click();
    tree.element().focus();
    await userEvent.keyboard("{ArrowDown}");
    await screen.getByRole("heading", { name: "Branches" }).hover();
    await expect.element(topic).toHaveAttribute("aria-selected", "true");
    await expect.element(marker).toHaveStyle({ opacity: "1" });
    await screen.getByRole("textbox", { name: "Filter branches" }).click();
    await expect.element(marker).toHaveStyle({ opacity: "0" });
    await expect
      .element(tree.getByRole("treeitem", { name: "origin" }))
      .toHaveAttribute("aria-expanded", "false");
  });

  it("switches views with arrow keys and remembers the choice after remounting", async () => {
    const { screen } = await renderSidebar();
    const treeView = screen.getByRole("radio", { name: "Tree view" });
    const linearView = screen.getByRole("radio", { name: "Linear view" });
    await expect.element(treeView).toBeChecked();
    treeView.element().focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(linearView).toBeChecked();
    await screen.unmount();
    const reopened = await renderSidebar();
    await expect
      .element(reopened.screen.getByRole("radio", { name: "Linear view" }))
      .toBeChecked();
  });

  it("navigates nested folders and checks out the full branch name", async () => {
    const { screen, onSelectRef } = await renderSidebar({
      snapshot: snapshot({ refs: nestedRefs(), status: "ready" }),
    });
    const tree = screen.getByRole("tree", { name: "Branches" });
    const feature = tree.getByRole("treeitem", {
      name: "feature",
      exact: true,
    });
    await feature.click();
    tree.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    const api = tree.getByRole("treeitem", {
      name: "feature/api",
      exact: true,
    });
    await expect
      .element(tree)
      .toHaveAttribute("aria-activedescendant", api.element().id);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    const alpha = tree.getByRole("treeitem", { name: "feature/api/alpha" });
    await expect.element(alpha).toHaveAttribute("aria-level", "4");
    await expect.element(alpha).toHaveTextContent("alpha");
    await userEvent.keyboard("{Enter}");
    expect(onSelectRef).toHaveBeenLastCalledWith({
      _tag: "LocalBranch",
      name: "feature/api/alpha",
    });
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    await expect.element(api).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{ArrowLeft}");
    await expect
      .element(tree)
      .toHaveAttribute("aria-activedescendant", feature.element().id);
    const filter = screen.getByRole("textbox", { name: "Filter branches" });
    await filter.fill("api/alpha");
    await expect.element(alpha).toBeVisible();
    await expect.element(api).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps inline sync counts and the worktree marker stable as counts change", async () => {
    const current = refs();
    const withSync = (ahead: number, behind: number): RepositoryRefs => ({
      ...current,
      branches: current.branches.map((branch) =>
        branch.name === "topic"
          ? {
              ...branch,
              upstream: { ahead, behind, gone: false, name: "origin/topic" },
            }
          : branch,
      ),
    });
    const callbacks = sidebarCallbacks();
    const screen = await render(
      sidebarView(
        snapshot({ refs: withSync(0, 2), status: "ready" }),
        callbacks,
      ),
    );
    const topic = screen.getByRole("treeitem", {
      name: "topic, linked worktree",
    });
    await topic.hover();
    const marker = topic.getByRole("img", { name: "Linked worktree" });
    const x = marker.element().getBoundingClientRect().x;
    const name = topic
      .getByText("topic", { exact: true })
      .element()
      .getBoundingClientRect();
    const pull = topic.getByRole("img", { name: "2 commits to pull" });
    expect(
      pull.element().getBoundingClientRect().left - name.right,
    ).toBeLessThan(12);
    await screen.rerender(
      sidebarView(
        snapshot({ refs: withSync(99, 111), status: "ready" }),
        callbacks,
      ),
    );
    await expect
      .element(topic.getByRole("img", { name: "111 commits to pull" }))
      .toBeVisible();
    expect(marker.element().getBoundingClientRect().x).toBe(x);
    expect(
      getComputedStyle(
        topic.getByRole("img", { name: "111 commits to pull" }).element(),
      ).fontFamily,
    ).toBe(getComputedStyle(topic.element()).fontFamily);
  });

  it("keeps a single click as focus and checks out on double click", async () => {
    const { onSelectRef, screen } = await renderSidebar();
    const feature = screen.getByRole("treeitem", { name: "feature" });

    await feature.click();
    expect(onSelectRef).not.toHaveBeenCalled();

    await feature.dblClick();
    expect(onSelectRef).toHaveBeenCalledOnce();
    expect(onSelectRef).toHaveBeenCalledWith({
      _tag: "LocalBranch",
      name: "feature",
    });

    await feature.click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Checkout" }).click();
    expect(onSelectRef).toHaveBeenCalledTimes(2);
    expect(onSelectRef).toHaveBeenLastCalledWith({
      _tag: "LocalBranch",
      name: "feature",
    });
  });

  it("adds and removes refs from history with pointer and keyboard", async () => {
    const { onToggleHistoryRef, screen } = await renderSidebar({
      selectedHistoryRefKeys: new Set([
        historyRefKey({ _tag: "LocalBranch", name: "main" }),
      ]),
    });

    await screen
      .getByRole("button", { name: "Add feature to history" })
      .click();
    expect(onToggleHistoryRef).toHaveBeenCalledWith({
      _tag: "LocalBranch",
      name: "feature",
    });

    const tree = screen.getByRole("tree", { name: "Branches" });
    await tree.getByRole("treeitem", { name: "main, current branch" }).click();
    tree.element().focus();
    await userEvent.keyboard(" ");
    expect(onToggleHistoryRef).toHaveBeenLastCalledWith({
      _tag: "LocalBranch",
      name: "main",
    });
    await expect
      .element(screen.getByRole("button", { name: "Remove main from history" }))
      .toBeVisible();
  });

  it("filters rows and switches ref scopes", async () => {
    const { screen } = await renderSidebar();
    const filter = screen.getByRole("textbox", { name: "Filter branches" });

    await filter.fill("feat");
    await expect
      .element(screen.getByRole("treeitem", { name: "feature" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("treeitem", { name: /main/ }))
      .not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await expect.element(filter).toHaveValue("");

    const tags = screen.getByRole("radio", { name: "Tags" });
    await screen
      .getByRole("radiogroup", { name: "Branch scope" })
      .getByText("Tags", { exact: true })
      .click();
    await expect.element(tags).toBeChecked();
    await expect
      .element(screen.getByRole("treeitem", { name: "v1.0.0" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("treeitem", { name: /main/ }))
      .not.toBeInTheDocument();
  });

  it("connects tree focus, navigation, expansion, and activation", async () => {
    const { onSelectRef, screen } = await renderSidebar({ focusRequest: 1 });
    const tree = screen.getByRole("tree", { name: "Branches" });
    const main = tree.getByRole("treeitem", {
      name: "main, current branch",
    });

    await expect.element(tree).toHaveFocus();
    await expect.element(main).toBeVisible();
    await expect
      .element(tree)
      .toHaveAttribute("aria-activedescendant", main.element().id);

    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onSelectRef).toHaveBeenCalledWith({
      _tag: "LocalBranch",
      name: "topic",
    });

    await userEvent.keyboard("{End}{ArrowRight}");
    await expect
      .element(screen.getByRole("treeitem", { name: "v1.0.0" }))
      .toBeVisible();
  });

  it("renders idle, loading, fetch error, and retry states", async () => {
    const callbacks = sidebarCallbacks();
    const screen = await render(
      sidebarView(snapshot({ status: "idle" }), callbacks),
    );

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("No repository selected.");

    await screen.rerender(
      sidebarView(snapshot({ status: "loading" }), callbacks),
    );
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Loading branches…");

    await screen.rerender(
      sidebarView(
        snapshot({ error: new RepositoryRefsUnavailable(), status: "error" }),
        callbacks,
      ),
    );
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("The Environment is not connected.");
    await screen.getByRole("button", { name: "Retry" }).click();
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
  });

  it("announces checkout progress and failures", async () => {
    const { screen } = await renderSidebar({
      snapshot: snapshot({
        checkingOut: true,
        checkoutError: new RepositoryRefsBusy(),
        refs: refs(),
        status: "ready",
      }),
    });

    await expect
      .element(screen.getByRole("tree", { name: "Branches" }))
      .toHaveAttribute("aria-busy", "true");
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("A checkout is still running.");
  });
});

async function renderSidebar({
  focusRequest = 0,
  selectedHistoryRefKeys,
  snapshot: currentSnapshot = snapshot({ refs: refs(), status: "ready" }),
}: {
  readonly focusRequest?: number;
  readonly selectedHistoryRefKeys?: ReadonlySet<string>;
  readonly snapshot?: RepositoryRefsSnapshot;
} = {}) {
  const callbacks = sidebarCallbacks();
  const screen = await render(
    sidebarView(
      currentSnapshot,
      callbacks,
      focusRequest,
      selectedHistoryRefKeys,
    ),
  );
  return { ...callbacks, screen };
}

function sidebarCallbacks() {
  return {
    onRetry: vi.fn<() => void>(),
    onSelectRef: vi.fn<(target: RepositoryRefTarget) => void>(),
    onToggleHistoryRef: vi.fn<(target: RepositoryRefTarget) => void>(),
  };
}

function sidebarView(
  currentSnapshot: RepositoryRefsSnapshot,
  callbacks: ReturnType<typeof sidebarCallbacks>,
  focusRequest = 0,
  selectedHistoryRefKeys?: ReadonlySet<string>,
) {
  return (
    <div style={{ height: 480, width: 320 }}>
      <BranchesSidebar
        activeWorktreePath={mainPath}
        focusRequest={focusRequest}
        onRetry={callbacks.onRetry}
        onSelectRef={callbacks.onSelectRef}
        onToggleHistoryRef={callbacks.onToggleHistoryRef}
        {...(selectedHistoryRefKeys === undefined
          ? {}
          : { selectedHistoryRefKeys })}
        snapshot={currentSnapshot}
      />
    </div>
  );
}

function snapshot(
  overrides: Partial<RepositoryRefsSnapshot>,
): RepositoryRefsSnapshot {
  return { checkingOut: false, status: "idle", ...overrides };
}

function refs(): RepositoryRefs {
  return {
    branches: [
      { name: "main", worktreePath: mainPath },
      { name: "feature" },
      { name: "topic", worktreePath: topicPath },
    ],
    remoteBranches: [{ name: "release", remote: "origin" }],
    repositoryId,
    tags: [{ name: "v1.0.0" }],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      { head: { branch: "main", commit }, main: true, path: mainPath },
      { head: { branch: "topic", commit }, main: false, path: topicPath },
    ],
  };
}

function nestedRefs(): RepositoryRefs {
  const current = refs();
  return {
    ...current,
    branches: [
      ...current.branches.filter((branch) => branch.name !== "feature"),
      { name: "feature/zeta" },
      { name: "feature/api/zeta" },
      { name: "feature/api/alpha" },
      { name: "bugfix/login" },
    ],
  };
}
