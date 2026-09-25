import type { RepositoryRefs, RepositoryRefTarget } from "@rebase/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { RepositoryBranchesRejected } from "#web/features/branch-management/index";
import type {
  BranchActions,
  BranchCreateRequest,
} from "#web/features/branches-sidebar/index";
import { NotificationsProvider } from "#web/features/notifications/index";
import { BranchesSidebar } from "#web-ui/features/branches-sidebar/branches-sidebar";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const mainPath = "/repo";
const topicPath = "/repo/.worktrees/topic";
const main = "a".repeat(40);
const spike = "b".repeat(40);

describe("branch editing", () => {
  beforeEach(() => localStorage.setItem("rebase:branches-view:v1", "linear"));

  it("creates a branch at a commit and switches to it", async () => {
    const actions = branchActions();
    const screen = await render(
      sidebar(refs(), actions, { oid: spike, sequence: 1 }),
    );
    const name = screen.getByRole("textbox", {
      name: `New branch from ${spike.slice(0, 7)}`,
    });
    await expect.element(name).toHaveFocus();

    await userEvent.keyboard("feature/spike{Enter}");
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("feature/spike already exists.");
    expect(actions.create).not.toHaveBeenCalled();

    await name.fill("feature/next");
    await userEvent.keyboard("{Enter}");
    expect(actions.create).toHaveBeenCalledWith({
      checkout: true,
      name: "feature/next",
      startPoint: spike,
    });
    await expect.element(name).not.toBeInTheDocument();
  });

  it("renames the active branch with F2 and cancels with Escape", async () => {
    const actions = branchActions();
    const screen = await render(sidebar(refs(), actions));
    const tree = screen.getByRole("tree", { name: "Branches" });
    await tree.getByRole("treeitem", { name: "feature/spike" }).click();

    await userEvent.keyboard("{F2}");
    const name = screen.getByRole("textbox", {
      name: "Rename feature/spike",
    });
    await expect.element(name).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(name).not.toBeInTheDocument();
    await expect.element(tree).toHaveFocus();

    await userEvent.keyboard("{F2}");
    await userEvent.keyboard("{Control>}a{/Control}spike/refs{Enter}");
    expect(actions.rename).toHaveBeenCalledWith({
      expectedTarget: spike,
      name: "feature/spike",
      newName: "spike/refs",
    });
  });

  it("deletes a merged branch at once and restores it with Undo", async () => {
    const actions = branchActions();
    const screen = await render(sidebar(refs(), actions));
    await screen.getByRole("treeitem", { name: "feature/merged" }).click();

    await userEvent.keyboard("{Delete}");
    await vi.waitFor(() =>
      expect(actions.delete).toHaveBeenCalledWith({
        force: false,
        local: { name: "feature/merged", target: main },
      }),
    );
    await screen.getByRole("button", { name: "Undo" }).click();
    await vi.waitFor(() =>
      expect(actions.create).toHaveBeenCalledWith({
        checkout: false,
        name: "feature/merged",
        startPoint: main,
        track: { name: "feature/merged", remote: "origin" },
      }),
    );
  });

  it("asks in a warning notification before deleting commits that exist only on the branch", async () => {
    const actions = branchActions();
    actions.delete.mockRejectedValueOnce(
      new RepositoryBranchesRejected({
        failure: {
          _tag: "BranchNotMerged",
          commits: [
            { oid: spike, subject: "Try refs index" },
            { oid: "c".repeat(40), subject: "Measure refs parse" },
            { oid: "d".repeat(40), subject: "Spike reader" },
          ],
          count: 5,
          name: "feature/spike",
        },
        status: 409,
      }),
    );
    const screen = await render(sidebar(refs(), actions));
    await screen.getByRole("treeitem", { name: "feature/spike" }).click();

    await userEvent.keyboard("{Delete}");
    const warning = screen.getByRole("alertdialog", {
      name: "Delete feature/spike",
    });
    await expect
      .element(warning)
      .toHaveTextContent(
        "5 commits exist only on this branch.bbbbbbbTry refs index",
      );
    await expect.element(warning).toHaveTextContent("and 2 more");
    await expect
      .element(warning.getByRole("button", { name: "Cancel" }))
      .toHaveFocus();
    await warning.getByRole("button", { name: "Delete", exact: true }).click();
    expect(actions.delete).toHaveBeenLastCalledWith({
      force: true,
      local: { name: "feature/spike", target: spike },
    });
  });

  it("confirms before deleting a branch locally and on its remote", async () => {
    const actions = branchActions();
    const screen = await render(sidebar(refs(), actions));
    await screen
      .getByRole("treeitem", { name: "feature/merged" })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Delete both" }).click();

    const confirmation = screen.getByRole("alertdialog", {
      name: "Delete feature/merged locally and on origin",
    });
    await expect.element(confirmation).toBeVisible();
    expect(actions.delete).not.toHaveBeenCalled();
    await confirmation
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await vi.waitFor(() =>
      expect(actions.delete).toHaveBeenCalledWith({
        force: false,
        local: { name: "feature/merged", target: main },
        remote: { name: "feature/merged", remote: "origin", target: main },
      }),
    );
    await expect.element(confirmation).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Undo" }))
      .not.toBeInTheDocument();
  });

  it("opens the branch menu from the keyboard and shows why checked-out branches cannot change", async () => {
    const screen = await render(sidebar(refs(), branchActions()));
    await screen
      .getByRole("treeitem", { name: "topic, linked worktree" })
      .click();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");

    await expect
      .element(screen.getByRole("menuitem", { name: /Rename/ }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("menuitem", { name: /Delete/ }))
      .toHaveTextContent("Delete localIn another worktree");
  });

  it("sets the upstream from the branch menu", async () => {
    const actions = branchActions();
    const screen = await render(sidebar(refs(), actions));
    await screen
      .getByRole("treeitem", { name: "feature/spike" })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: /Upstream/ }).click();

    await expect
      .element(screen.getByRole("combobox", { name: "Filter remote branches" }))
      .toHaveFocus();
    await userEvent.keyboard("main");
    await screen.getByRole("option", { name: "origin/main" }).click();
    expect(actions.setUpstream).toHaveBeenCalledWith({
      name: "feature/spike",
      upstream: { name: "main", remote: "origin" },
    });
  });
  it("shows an upstream failure after the picker closes", async () => {
    const actions = branchActions();
    actions.setUpstream.mockRejectedValueOnce(
      new RepositoryBranchesRejected({
        failure: { _tag: "RefMissing", name: "origin/main" },
        status: 404,
      }),
    );
    const screen = await render(sidebar(refs(), actions));
    await screen
      .getByRole("treeitem", { name: "feature/spike" })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: /Upstream/ }).click();
    await screen.getByRole("option", { name: "origin/main" }).click();

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("origin/main no longer exists.");
  });
});

function branchActions() {
  return {
    create: vi.fn<BranchActions["create"]>(async () => undefined),
    delete: vi.fn<BranchActions["delete"]>(async ({ local, remote }) => ({
      ...(local === undefined ? {} : { local }),
      ...(remote === undefined ? {} : { remote }),
    })),
    rename: vi.fn<BranchActions["rename"]>(async () => undefined),
    setUpstream: vi.fn<BranchActions["setUpstream"]>(async () => undefined),
  };
}

function sidebar(
  repositoryRefs: RepositoryRefs,
  actions: BranchActions,
  createBranchRequest?: BranchCreateRequest,
) {
  return (
    <NotificationsProvider>
      <div style={{ height: 520, width: 320 }}>
        <BranchesSidebar
          activeWorktreePath={mainPath}
          branchActions={actions}
          createBranchRequest={createBranchRequest}
          focusRequest={0}
          onRetry={() => undefined}
          onSelectRef={(_target: RepositoryRefTarget) => undefined}
          snapshot={{
            checkingOut: false,
            refs: repositoryRefs,
            repositoryId,
            status: "ready",
          }}
        />
      </div>
    </NotificationsProvider>
  );
}

function refs(): RepositoryRefs {
  return {
    branches: [
      { name: "main", target: main, worktreePath: mainPath },
      {
        name: "feature/merged",
        target: main,
        upstream: {
          ahead: 0,
          behind: 0,
          gone: false,
          name: "origin/feature/merged",
        },
      },
      { name: "feature/spike", target: spike },
      { name: "topic", target: main, worktreePath: topicPath },
    ],
    remoteBranches: [
      { name: "feature/merged", remote: "origin", target: main },
      { name: "main", remote: "origin", target: main },
      { name: "release", remote: "origin", target: main },
    ],
    repositoryId,
    tags: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      { head: { branch: "main", commit: main }, main: true, path: mainPath },
      { head: { branch: "topic", commit: main }, main: false, path: topicPath },
    ],
  };
}
