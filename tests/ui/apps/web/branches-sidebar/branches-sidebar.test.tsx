import {
  type CheckoutRepositoryRef,
  type RepositoryCheckedOut,
  type RepositoryFreshness,
  RepositoryPullHttpApi,
  type RepositoryRefs,
  RepositoryRefsHttpApi,
  type RepositoryRefTarget,
} from "@rebase/contracts";
import { EnvironmentHttpRejected } from "@rebase/environment-client";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  type FakeRoute,
  fakeRequests,
  idleOperation,
  respond,
} from "#tests-ui/runtime/fake-requests";
import { fakeRpc } from "#tests-ui/runtime/fake-rpc";
import { render } from "#tests-ui/runtime/render";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar";
import { historyRefKey } from "#web/features/commit-graph/scope/history-scope";
import { requestRefIntent } from "#web/features/refs/ref-actions";
import type { PullReader } from "#web/features/remote-sync/use-pull";
import type { EnvironmentChangeListener } from "#web/platform/environment/environment-protocol.contract";
import {
  type RepositoryScope,
  RepositoryScopeProvider,
} from "#web/platform/query/repository-scope";

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
    const { screen, checkouts } = await renderSidebar({ refs: nestedRefs() });
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
    await expect
      .poll(() => checkouts)
      .toHaveBeenLastCalledWith({
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
    const { screen, publish } = await renderSidebar({
      refs: withSync(0, 2),
    });
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
    publish(withSync(99, 111));
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
    const { checkouts, screen } = await renderSidebar();
    const feature = screen.getByRole("treeitem", { name: "feature" });

    await feature.click();
    expect(checkouts).not.toHaveBeenCalled();

    await feature.dblClick();
    await expect.poll(() => checkouts).toHaveBeenCalledOnce();
    expect(checkouts).toHaveBeenCalledWith({
      _tag: "LocalBranch",
      name: "feature",
    });

    await feature.click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Checkout" }).click();
    await expect.poll(() => checkouts).toHaveBeenCalledTimes(2);
    expect(checkouts).toHaveBeenLastCalledWith({
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
    const { screen } = await renderSidebar({
      refs: tracked,
      reader: pulls.reader,
      routes: [pulls.route],
    });
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
    await expect.poll(() => pulls.pulled).toHaveBeenLastCalledWith("feature");

    await feature.click({ button: "right" });
    await expect
      .element(screen.getByRole("menuitem", { name: "Pull" }))
      .toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");
    pulls.finish();

    tree.element().focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await screen.getByRole("menuitem", { name: "Pull" }).click();
    await expect.poll(() => pulls.pulled).toHaveBeenCalledTimes(2);
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
    const switchWorktree = vi.fn<(worktreePath: string) => void>();
    const { screen } = await renderSidebar({ switchWorktree });
    const tree = screen.getByRole("tree", { name: "Branches" });
    const main = tree.getByRole("treeitem", {
      name: "main, current branch",
    });
    await expect.element(main).toBeVisible();
    requestRefIntent({ _tag: "FocusRefs" });

    await expect.element(tree).toHaveFocus();
    await expect.element(main).toBeVisible();
    await expect
      .element(tree)
      .toHaveAttribute("aria-activedescendant", main.element().id);

    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(switchWorktree).toHaveBeenCalledWith(topicPath);

    await userEvent.keyboard("{End}{ArrowRight}");
    await expect
      .element(screen.getByRole("treeitem", { name: "v1.0.0" }))
      .toBeVisible();
  });

  it("renders idle, loading, fetch error, and retry states", async () => {
    const reads: PromiseWithResolvers<RepositoryRefs>[] = [];
    const rpc = await fakeRpc(() => {
      const read = Promise.withResolvers<RepositoryRefs>();
      reads.push(read);
      return read.promise;
    });
    const view = (scope: RepositoryScope | undefined) => (
      <RepositoryScopeProvider scope={scope}>
        <div style={{ height: 480, width: 320 }}>
          <BranchesSidebar reader={undefined} />
        </div>
      </RepositoryScopeProvider>
    );
    const screen = await render(view(undefined), { environment: { rpc } });

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("No repository selected.");

    await screen.rerender(view(repositoryScope({ repositoryId })));
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Loading branches…");

    await expect.poll(() => reads.length).toBe(1);
    reads[0]?.reject(new Error("connection closed"));
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("The Environment did not answer.");
    await screen.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => reads.length).toBe(2);
  });

  it("announces checkout progress and failures", async () => {
    const rejected = new EnvironmentHttpRejected({
      failure: { _tag: "CheckoutRejected", detail: "", reason: "LocalChanges" },
    });
    let answer = (): Promise<RepositoryCheckedOut> => Promise.reject(rejected);
    const { screen } = await renderSidebar({
      routes: [respond(RepositoryRefsHttpApi.checkout, () => answer())],
    });
    const tree = screen.getByRole("tree", { name: "Branches" });
    const feature = tree.getByRole("treeitem", { name: "feature" });

    await feature.dblClick();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Local changes would be overwritten.");

    answer = () => new Promise(() => undefined);
    await feature.dblClick();
    await expect.element(tree).toHaveAttribute("aria-busy", "true");
  });
});

function pullRequests() {
  const pulled = vi.fn<(branch: string) => void>();
  let finish = () => {};
  const reader: PullReader = {
    fetch: async (): Promise<RepositoryFreshness> => ({
      revision: 1,
      fetching: false,
      stale: false,
      defaultIntervalSeconds: 300,
      setting: { _tag: "Inherit" },
    }),
    getSnapshot: () => readyHistory,
    subscribe: () => () => {},
  };
  return {
    pulled,
    finish: () => finish(),
    reader,
    route: respond(RepositoryPullHttpApi.pull, async (command) => {
      pulled(command.branch);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { outcome: "FastForwarded" as const };
    }),
  };
}

async function renderSidebar({
  refs: initial = refs(),
  reader,
  routes = [],
  selectedHistoryRefKeys,
  switchWorktree,
}: {
  readonly refs?: RepositoryRefs;
  readonly reader?: PullReader;
  readonly routes?: readonly FakeRoute[];
  readonly selectedHistoryRefKeys?: ReadonlySet<string>;
  readonly switchWorktree?: (worktreePath: string) => void;
} = {}) {
  let current = initial;
  const listeners = new Set<EnvironmentChangeListener>();
  const checkouts = vi.fn<(target: RepositoryRefTarget) => void>();
  const onToggleHistoryRef = vi.fn<(target: RepositoryRefTarget) => void>();
  const checkout = respond(
    RepositoryRefsHttpApi.checkout,
    async (command: CheckoutRepositoryRef): Promise<RepositoryCheckedOut> => {
      checkouts(command.target);
      return {
        head: { branch: command.target.name, commit },
        stash: "none",
        worktreePath: command.worktreePath,
      };
    },
  );
  const screen = await render(
    <RepositoryScopeProvider
      scope={repositoryScope({
        repositoryId,
        worktreePath: mainPath,
        ...(switchWorktree === undefined ? {} : { switchWorktree }),
      })}
    >
      <div style={{ height: 480, width: 320 }}>
        <BranchesSidebar
          onToggleHistoryRef={onToggleHistoryRef}
          reader={reader}
          {...(selectedHistoryRefKeys === undefined
            ? {}
            : { selectedHistoryRefKeys })}
        />
      </div>
    </RepositoryScopeProvider>,
    {
      environment: {
        rpc: await fakeRpc(async () => current),
        requests: fakeRequests(idleOperation, ...routes, checkout),
        changes: {
          subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      },
    },
  );
  return {
    screen,
    checkouts,
    onToggleHistoryRef,
    publish: (next: RepositoryRefs) => {
      current = next;
      for (const listener of listeners) listener([repositoryId], "Refs");
    },
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
