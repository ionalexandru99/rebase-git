import {
  type RepositoryFreshness,
  RepositoryPullHttpApi,
  type RepositoryRefs,
  type RepositoryRefTarget,
} from "@rebase/contracts";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  fakeRequests,
  idleOperation,
  respond,
} from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import { historyRefKey } from "#web/features/commit-graph/index";
import { RefCommands } from "#web/features/ref-commands/index";
import { usePull } from "#web/features/repository-pull/index";
import type {
  RefActivation,
  RepositoryRefsRead,
} from "#web/features/repository-refs/index";
import { RepositoryScopeProvider } from "#web/features/repository-scope/index";
import { BranchesSidebar } from "#web-ui/features/branches-sidebar/branches-sidebar";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const mainPath = "/repo";
const topicPath = "/repo/.worktrees/topic";
const commit = "a".repeat(40);
const readyHistory = {
  revision: 0,
  historyRevision: 0,
  status: "ready",
} as const;
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
      repositoryRefs: loaded(nestedRefs()),
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
    const screen = await render(sidebarView(loaded(withSync(0, 2)), callbacks));
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
    await screen.rerender(sidebarView(loaded(withSync(99, 111)), callbacks));
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

  it("pulls a tracked branch from its menu with pointer and keyboard", async () => {
    const current = refs();
    const tracked: RepositoryRefs = {
      ...current,
      branches: current.branches.map((branch) =>
        branch.name === "feature"
          ? {
              ...branch,
              upstream: {
                ahead: 0,
                behind: 2,
                gone: false,
                name: "origin/feature",
              },
            }
          : branch,
      ),
    };
    const pulls = pullRequests();
    const callbacks = sidebarCallbacks();
    const screen = await render(
      <RepositoryScopeProvider scope={pulls.scope}>
        <PullCommands reader={pulls.reader}>
          <div style={{ height: 480, width: 320 }}>
            <BranchesSidebar
              activeWorktreePath={mainPath}
              focusRequest={0}
              activation={activation(callbacks)}
              repositoryRefs={loaded(tracked)}
            />
          </div>
        </PullCommands>
      </RepositoryScopeProvider>,
      { environment: { requests: pulls.requests } },
    );
    const tree = screen.getByRole("tree", { name: "Branches" });

    await tree
      .getByRole("treeitem", { name: "main, current branch" })
      .click({ button: "right" });
    await expect
      .element(screen.getByRole("menuitem", { name: "Checkout" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("menuitem", { name: "Pull" }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    const feature = tree.getByRole("treeitem", { name: "feature" });
    await feature.click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Pull" }).click();
    await vi.waitFor(() =>
      expect(pulls.pulled).toHaveBeenLastCalledWith("feature"),
    );

    await feature.click({ button: "right" });
    await expect
      .element(screen.getByRole("menuitem", { name: "Pull" }))
      .toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");
    pulls.finish();

    tree.element().focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await screen.getByRole("menuitem", { name: "Pull" }).click();
    await vi.waitFor(() => expect(pulls.pulled).toHaveBeenCalledTimes(2));
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
    const screen = await render(sidebarView(refsRead({}), callbacks));

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("No repository selected.");

    await screen.rerender(sidebarView(refsRead({ loading: true }), callbacks));
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Loading branches…");

    await screen.rerender(
      sidebarView(
        refsRead({ error: "The Environment did not answer." }),
        callbacks,
      ),
    );
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("The Environment did not answer.");
    await screen.getByRole("button", { name: "Retry" }).click();
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
  });

  it("announces checkout progress and failures", async () => {
    const { screen } = await renderSidebar({
      checkout: {
        checkingOut: true,
        error: "Local changes would be overwritten.",
      },
    });

    await expect
      .element(screen.getByRole("tree", { name: "Branches" }))
      .toHaveAttribute("aria-busy", "true");
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Local changes would be overwritten.");
  });
});

function pullRequests() {
  const pulled = vi.fn<(branch: string) => void>();
  let finish = () => {};
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryPullHttpApi.pull, async (command) => {
      pulled(command.branch);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { outcome: "FastForwarded" as const };
    }),
  );
  return {
    pulled,
    finish: () => finish(),
    reader: {
      fetch: async (): Promise<RepositoryFreshness> => ({
        revision: 1,
        fetching: false,
        stale: false,
        defaultIntervalSeconds: 300,
        setting: { _tag: "Inherit" },
      }),
      getSnapshot: () => readyHistory,
      subscribe: () => () => {},
    },
    requests,
    scope: repositoryScope({ repositoryId, worktreePath: mainPath }),
  };
}

async function renderSidebar({
  checkout,
  focusRequest = 0,
  selectedHistoryRefKeys,
  repositoryRefs = loaded(refs()),
}: {
  readonly checkout?: Omit<RefActivation, "select">;
  readonly focusRequest?: number;
  readonly selectedHistoryRefKeys?: ReadonlySet<string>;
  readonly repositoryRefs?: RepositoryRefsRead;
} = {}) {
  const callbacks = sidebarCallbacks();
  const screen = await render(
    sidebarView(
      repositoryRefs,
      callbacks,
      focusRequest,
      selectedHistoryRefKeys,
      checkout,
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
  repositoryRefs: RepositoryRefsRead,
  callbacks: ReturnType<typeof sidebarCallbacks>,
  focusRequest = 0,
  selectedHistoryRefKeys?: ReadonlySet<string>,
  checkout?: Omit<RefActivation, "select">,
) {
  return (
    <div style={{ height: 480, width: 320 }}>
      <BranchesSidebar
        activation={activation(callbacks, checkout)}
        activeWorktreePath={mainPath}
        focusRequest={focusRequest}
        onToggleHistoryRef={callbacks.onToggleHistoryRef}
        repositoryRefs={{ ...repositoryRefs, retry: callbacks.onRetry }}
        {...(selectedHistoryRefKeys === undefined
          ? {}
          : { selectedHistoryRefKeys })}
      />
    </div>
  );
}

function activation(
  callbacks: ReturnType<typeof sidebarCallbacks>,
  checkout: Omit<RefActivation, "select"> = {
    checkingOut: false,
    error: null,
  },
): RefActivation {
  return { ...checkout, select: callbacks.onSelectRef };
}

function loaded(current: RepositoryRefs): RepositoryRefsRead {
  return refsRead({ refs: current });
}

function refsRead(overrides: Partial<RepositoryRefsRead>): RepositoryRefsRead {
  return {
    refs: undefined,
    restored: false,
    loading: false,
    error: null,
    retry: () => undefined,
    ...overrides,
  };
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

function PullCommands({
  reader,
  children,
}: {
  readonly reader: Parameters<typeof usePull>[0];
  readonly children: ReactNode;
}) {
  const pull = usePull(reader);
  return (
    <RefCommands.Contribute commands={pull.commands}>
      {children}
    </RefCommands.Contribute>
  );
}
