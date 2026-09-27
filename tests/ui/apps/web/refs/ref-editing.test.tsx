import {
  type EnvironmentRoute,
  RepositoryBranchesApi,
  type RepositoryRefs,
  RepositoryRefsApi,
  RepositoryTagsApi,
  type RouteFailure,
  type RouteInput,
  type RouteSuccess,
} from "@rebase/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  commitId,
  mainAndTopicWorktrees,
  mainPath,
  repositoryId,
  repositoryRefs,
  topicPath,
  upstream,
} from "#tests-support/fixtures";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  fakeRequests,
  idleOperation,
  rejected,
  respond,
} from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar";
import { CommitActionMenu } from "#web/features/commit-graph/commit-actions";
import { NotificationsProvider } from "#web/features/notifications/notifications";
import { createRefActions } from "#web/features/refs/ref-actions";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope";

const main = commitId;
const spike = "b".repeat(40);
const scope = { repositoryId, worktreePath: mainPath };

type RefRoute =
  | keyof typeof RepositoryBranchesApi
  | keyof typeof RepositoryRefsApi
  | "createTag"
  | "deleteTag";

interface BranchRename {
  readonly name: string;
  readonly newName: string;
}

describe("ref editing", () => {
  beforeEach(() => localStorage.setItem("rebase:branches-view:v1", "linear"));

  it("creates a branch at a commit and switches to it", async () => {
    const environment = await refsEnvironment();
    const screen = await renderBranches(environment, spike);
    await screen
      .getByRole("button", { name: `Commit ${spike.slice(0, 7)}` })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Create branch here…" }).click();
    const name = screen.getByRole("textbox", {
      name: `New branch from ${spike.slice(0, 7)}`,
    });
    await expect.element(name).toHaveFocus();

    await userEvent.keyboard("feature/spike{Enter}");
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("feature/spike already exists.");
    expect(environment.requested).not.toHaveBeenCalled();

    await name.fill("feature/next");
    await userEvent.keyboard("{Enter}");
    await expect.element(name).not.toBeInTheDocument();
    expect(environment.requested).toHaveBeenCalledWith("create", {
      ...scope,
      name: "feature/next",
      startPoint: spike,
    });
    await expect
      .poll(() => environment.requested)
      .toHaveBeenCalledWith("checkout", {
        ...scope,
        target: { _tag: "LocalBranch", name: "feature/next" },
      });
    await expect
      .element(
        screen.getByRole("treeitem", { name: "feature/next, current branch" }),
      )
      .toBeVisible();
  });

  it("renames the active branch with F2 and cancels with Escape", async () => {
    const environment = await refsEnvironment();
    const renamed = vi.fn();
    const screen = await renderBranches(environment, undefined, renamed);
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

    environment.rejectNext("rename", {
      _tag: "BranchMoved",
      name: "feature/spike",
    });
    await userEvent.keyboard("{F2}");
    await userEvent.keyboard("{Control>}a{/Control}spike/refs{Enter}");
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("feature/spike changed since it was shown.");
    expect(renamed).not.toHaveBeenCalled();

    await userEvent.keyboard("{Enter}");
    await expect
      .element(tree.getByRole("treeitem", { name: "spike/refs" }))
      .toBeVisible();
    await expect
      .element(tree.getByRole("treeitem", { name: "feature/spike" }))
      .not.toBeInTheDocument();
    expect(environment.requested).toHaveBeenLastCalledWith("rename", {
      ...scope,
      expectedTarget: spike,
      name: "feature/spike",
      newName: "spike/refs",
    });
    expect(renamed).toHaveBeenCalledExactlyOnceWith({
      name: "feature/spike",
      newName: "spike/refs",
    });
  });

  it("deletes a merged branch at once and restores it with Undo", async () => {
    const environment = await refsEnvironment();
    const screen = await renderBranches(environment);
    await screen.getByRole("treeitem", { name: "feature/merged" }).click();

    await userEvent.keyboard("{Delete}");
    await expect
      .poll(() => environment.requested)
      .toHaveBeenCalledWith("delete", {
        ...scope,
        force: false,
        local: { name: "feature/merged", target: main },
      });
    const merged = screen.getByRole("treeitem", { name: "feature/merged" });
    await expect.element(merged).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Undo" }).click();
    await expect.element(merged).toBeVisible();
    await expect
      .poll(() => environment.requested)
      .toHaveBeenCalledWith("create", {
        ...scope,
        name: "feature/merged",
        startPoint: main,
        track: { name: "feature/merged", remote: "origin" },
      });
    expect(environment.requested).not.toHaveBeenCalledWith(
      "checkout",
      expect.anything(),
    );
  });

  it("asks in a warning notification before deleting commits that exist only on the branch", async () => {
    const environment = await refsEnvironment();
    environment.rejectNext("delete", {
      _tag: "BranchNotMerged",
      commits: [
        { oid: spike, subject: "Try refs index" },
        { oid: "c".repeat(40), subject: "Measure refs parse" },
        { oid: "d".repeat(40), subject: "Spike reader" },
      ],
      count: 5,
      name: "feature/spike",
    });
    const screen = await renderBranches(environment);
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
    await expect
      .poll(() => environment.requested)
      .toHaveBeenLastCalledWith("delete", {
        ...scope,
        force: true,
        local: { name: "feature/spike", target: spike },
      });
  });

  it("confirms before deleting a branch locally and on its remote", async () => {
    const environment = await refsEnvironment();
    const screen = await renderBranches(environment);
    await screen
      .getByRole("treeitem", { name: "feature/merged" })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Delete both" }).click();

    const confirmation = screen.getByRole("alertdialog", {
      name: "Delete feature/merged locally and on origin",
    });
    await expect.element(confirmation).toBeVisible();
    expect(environment.requested).not.toHaveBeenCalled();
    await confirmation
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect
      .poll(() => environment.requested)
      .toHaveBeenCalledWith("delete", {
        ...scope,
        force: false,
        local: { name: "feature/merged", target: main },
        remote: { name: "feature/merged", remote: "origin", target: main },
      });
    await expect.element(confirmation).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Undo" }))
      .not.toBeInTheDocument();
  });

  it("opens the branch menu from the keyboard and shows why checked-out branches cannot change", async () => {
    const screen = await renderBranches(await refsEnvironment());
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
    const environment = await refsEnvironment();
    const screen = await renderBranches(environment);
    await screen
      .getByRole("treeitem", { name: "feature/spike" })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: /Upstream/ }).click();

    await expect
      .element(screen.getByRole("combobox", { name: "Filter remote branches" }))
      .toHaveFocus();
    await userEvent.keyboard("main");
    await screen.getByRole("option", { name: "origin/main" }).click();
    await expect
      .poll(() => environment.requested)
      .toHaveBeenCalledWith("setUpstream", {
        ...scope,
        name: "feature/spike",
        upstream: { name: "main", remote: "origin" },
      });
  });
  it("shows an upstream failure after the picker closes", async () => {
    const environment = await refsEnvironment();
    environment.rejectNext("setUpstream", {
      _tag: "RefMissing",
      name: "origin/main",
    });
    const screen = await renderBranches(environment);
    await screen
      .getByRole("treeitem", { name: "feature/spike" })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: /Upstream/ }).click();
    await screen.getByRole("option", { name: "origin/main" }).click();

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("origin/main no longer exists.");
  });
  it("creates a tag from the graph menu and deletes it from the sidebar", async () => {
    const environment = await refsEnvironment();
    const screen = await renderBranches(environment, spike);
    await screen
      .getByRole("button", { name: `Commit ${spike.slice(0, 7)}` })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Create tag here…" }).click();
    const name = screen.getByRole("textbox", {
      name: `New tag at ${spike.slice(0, 7)}`,
    });
    await expect.element(name).toHaveFocus();

    await userEvent.keyboard("v1.0{Enter}");
    const tag = screen.getByRole("treeitem", { name: "v1.0" });
    await expect.element(tag).toBeVisible();
    expect(environment.requested).toHaveBeenCalledWith("createTag", {
      ...scope,
      name: "v1.0",
      target: spike,
    });

    await tag.click({ button: "right" });
    await screen.getByRole("menuitem", { name: /Delete tag/ }).click();
    const confirmation = screen.getByRole("alertdialog", {
      name: "Delete tag v1.0",
    });
    expect(environment.requested).not.toHaveBeenCalledWith(
      "deleteTag",
      expect.anything(),
    );
    await confirmation
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect.element(tag).not.toBeInTheDocument();
    expect(environment.requested).toHaveBeenCalledWith("deleteTag", {
      ...scope,
      name: "v1.0",
    });
  });

  it("reports a tag that could not be deleted", async () => {
    const environment = await refsEnvironment();
    environment.rejectNext("deleteTag", { _tag: "RefMissing", name: "v0.9" });
    const screen = await renderBranches(environment);
    await screen.getByRole("treeitem", { name: "Tags" }).click();
    await screen.getByRole("treeitem", { name: "v0.9" }).click();

    await userEvent.keyboard("{Delete}");
    await screen
      .getByRole("alertdialog", { name: "Delete tag v0.9" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    await expect
      .element(screen.getByText("v0.9 no longer exists."))
      .toBeVisible();
  });
});

type RefFailure = RouteFailure<
  | (typeof RepositoryBranchesApi)[keyof typeof RepositoryBranchesApi]
  | typeof RepositoryTagsApi.delete
>;

async function refsEnvironment() {
  const requested = vi.fn<(route: RefRoute, command: unknown) => void>();
  const rejections = new Map<RefRoute, RefFailure>();
  let current = refs();
  const reply = <Route extends EnvironmentRoute>(
    name: RefRoute,
    route: Route,
    answer: (command: RouteInput<Route>) => RouteSuccess<Route>,
  ) =>
    respond(route, async (command) => {
      requested(name, command);
      const failure = rejections.get(name);
      rejections.delete(name);
      if (failure !== undefined) throw rejected(failure);
      return answer(command);
    });
  const branches = (
    change: (
      branches: RepositoryRefs["branches"],
    ) => RepositoryRefs["branches"],
  ) => {
    current = { ...current, branches: change(current.branches) };
  };
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryRefsApi.read, async () => current),
    reply("create", RepositoryBranchesApi.create, ({ name }) => {
      const branch = { name, target: main };
      branches((all) => [...all, branch]);
      return branch;
    }),
    reply("rename", RepositoryBranchesApi.rename, (command) => {
      const branch = { name: command.newName, target: spike };
      branches((all) =>
        all.map((existing) =>
          existing.name === command.name ? branch : existing,
        ),
      );
      return { branch, previousName: command.name };
    }),
    reply("delete", RepositoryBranchesApi.delete, ({ local, remote }) => {
      branches((all) => all.filter(({ name }) => name !== local?.name));
      current = {
        ...current,
        remoteBranches: current.remoteBranches.filter(
          (branch) =>
            branch.name !== remote?.name || branch.remote !== remote.remote,
        ),
      };
      return {
        ...(local === undefined ? {} : { local }),
        ...(remote === undefined ? {} : { remote }),
      };
    }),
    reply("setUpstream", RepositoryBranchesApi.setUpstream, ({ name }) => ({
      name,
      target: main,
    })),
    reply("createTag", RepositoryTagsApi.create, (command) => {
      const tag = { name: command.name, target: command.target };
      current = { ...current, tags: [...current.tags, tag] };
      return tag;
    }),
    reply("deleteTag", RepositoryTagsApi.delete, (command) => {
      current = {
        ...current,
        tags: current.tags.filter(({ name }) => name !== command.name),
      };
      return { name: command.name, target: spike };
    }),
    reply("checkout", RepositoryRefsApi.checkout, (command) => {
      const head = { branch: command.target.name, commit: spike };
      current = {
        ...current,
        worktrees: current.worktrees.map((worktree) =>
          worktree.path === command.worktreePath
            ? { ...worktree, head }
            : worktree,
        ),
      };
      return {
        head,
        stash: "none" as const,
        worktreePath: command.worktreePath,
      };
    }),
  );
  return {
    requested,
    rejectNext: (route: RefRoute, failure: RefFailure) =>
      rejections.set(route, failure),
    environment: { requests },
  };
}

function renderBranches(
  environment: Awaited<ReturnType<typeof refsEnvironment>>,
  createBranchAt?: string,
  onBranchRenamed: (rename: BranchRename) => void = () => undefined,
) {
  return render(
    <NotificationsProvider>
      <RepositoryScopeProvider
        scope={repositoryScope({ ...scope, logicalRepositoryId: repositoryId })}
      >
        <BranchWorkspace
          createBranchAt={createBranchAt}
          onBranchRenamed={onBranchRenamed}
        />
      </RepositoryScopeProvider>
    </NotificationsProvider>,
    { environment: environment.environment },
  );
}

function BranchWorkspace({
  createBranchAt,
  onBranchRenamed,
}: {
  readonly createBranchAt: string | undefined;
  readonly onBranchRenamed: (rename: BranchRename) => void;
}) {
  return (
    <>
      {createBranchAt === undefined ? null : (
        <CommitActionMenu
          actions={createRefActions(createBranchAt, {
            connected: true,
            writable: true,
          })}
          restoreFocus={() => undefined}
        >
          <button type="button">Commit {createBranchAt.slice(0, 7)}</button>
        </CommitActionMenu>
      )}
      <div style={{ height: 520, width: 320 }}>
        <BranchesSidebar onBranchRenamed={onBranchRenamed} reader={undefined} />
      </div>
    </>
  );
}

function refs(): RepositoryRefs {
  return repositoryRefs({
    branches: [
      { name: "main", target: main, worktreePath: mainPath },
      {
        name: "feature/merged",
        target: main,
        upstream: upstream("origin/feature/merged"),
      },
      { name: "feature/spike", target: spike },
      { name: "topic", target: main, worktreePath: topicPath },
    ],
    remoteBranches: [
      { name: "feature/merged", remote: "origin", target: main },
      { name: "main", remote: "origin", target: main },
      { name: "release", remote: "origin", target: main },
    ],
    tags: [{ name: "v0.9", target: main }],
    worktrees: mainAndTopicWorktrees(),
  });
}
