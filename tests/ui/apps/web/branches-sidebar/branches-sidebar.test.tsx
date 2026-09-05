import type { RepositoryRefs, RepositoryRefTarget } from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { historyRefKey } from "#web/features/commit-graph/scope/history-scope";
import { defaultKeyboardShortcutBindings } from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type { KeyboardShortcutRuntime } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";
import {
  RepositoryRefsBusy,
  type RepositoryRefsSnapshot,
  RepositoryRefsUnavailable,
} from "#web/features/repository-refs/repository-refs-controller.contract";
import { BranchesSidebar } from "#web-ui/features/branches-sidebar/branches-sidebar";
import { KeyboardShortcutsProvider } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const mainPath = "/repo";
const topicPath = "/repo/.worktrees/topic";
const commit = "a".repeat(40);
const shortcutSnapshot = {
  bindings: defaultKeyboardShortcutBindings,
  modifiedCommandIds: [],
} as const;
const shortcutRuntime: KeyboardShortcutRuntime = {
  host: { client: "browser", platform: "other" },
  store: {
    getSnapshot: () => shortcutSnapshot,
    resetAll: () => undefined,
    resetBinding: () => undefined,
    setBinding: () => undefined,
    subscribe: () => () => undefined,
  },
};

describe("branches sidebar", () => {
  it("renders branches with their active and worktree labels", async () => {
    const { screen } = await renderSidebar();
    const tree = screen.getByRole("tree", { name: "Branches" });
    const main = tree.getByRole("treeitem", {
      name: "main, this worktree",
    });
    const topic = tree.getByRole("treeitem", {
      name: "topic, checked out in another worktree",
    });

    await expect.element(main).toHaveAttribute("aria-selected", "true");
    await expect
      .element(main.getByText("This worktree", { exact: true }))
      .toBeVisible();
    await expect
      .element(topic.getByText("Worktree", { exact: true }))
      .toBeVisible();
    await expect
      .element(tree.getByRole("treeitem", { name: "origin, 1" }))
      .toHaveAttribute("aria-expanded", "false");
    await expect
      .element(tree.getByRole("treeitem", { name: "Tags, 1" }))
      .toHaveAttribute("aria-expanded", "false");
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
    await tree.getByRole("treeitem", { name: "main, this worktree" }).click();
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
      name: "main, this worktree",
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

    await userEvent.keyboard("/");
    await expect
      .element(screen.getByRole("textbox", { name: "Filter branches" }))
      .toHaveFocus();
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
    <KeyboardShortcutsProvider runtime={shortcutRuntime}>
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
    </KeyboardShortcutsProvider>
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
