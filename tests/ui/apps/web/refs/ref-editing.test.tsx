import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type {
  EnvironmentRoute,
  RouteFailure,
  RouteInput,
  RouteSuccess,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryPushApi } from "#contracts/repository-push/repository-push.contract.ts";
import {
  RepositoryBranchesApi,
  type RepositoryBranchesDeleted,
  type UnmergedBranch,
} from "#contracts/repository-refs/repository-branches.contract.ts";
import {
  type RepositoryRefs,
  RepositoryRefsApi,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import { RepositoryTagsApi } from "#contracts/repository-refs/repository-tags.contract.ts";
import {
  fakeRequests,
  idleOperation,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  commitId,
  mainAndTopicWorktrees,
  mainPath,
  repositoryId,
  repositoryRefs,
  repositoryScope,
  topicPath,
  upstream,
} from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar.tsx";
import { CommitActionMenu } from "#web/features/commit-graph/commit-actions.tsx";
import { CommitRefPill } from "#web/features/commit-graph/components/commit-ref-labels.tsx";
import { createRefActions } from "#web/features/refs/ref-actions.ts";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const main = commitId;
const spike = "b".repeat(40);
const annotated = "c".repeat(40);
const scope = { repositoryId, worktreePath: mainPath };

type RefRoute =
  | keyof typeof RepositoryBranchesApi
  | keyof typeof RepositoryRefsApi
  | "createTag"
  | "deleteTag"
  | "pushTags";

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
      .element(screen.getByText("Couldn't rename the branch"))
      .toBeVisible();
    await expect
      .element(screen.getByText("feature/spike changed since it was shown."))
      .toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Rename feature/spike" }))
      .toHaveValue("spike/refs");
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
        branches: [{ local: { name: "feature/merged", target: main } }],
        force: false,
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
    environment.keepUnmerged("feature/spike", {
      commits: [
        { oid: spike, subject: "Try refs index" },
        { oid: "c".repeat(40), subject: "Measure refs parse" },
        { oid: "d".repeat(40), subject: "Spike reader" },
      ],
      count: 5,
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
        branches: [{ local: { name: "feature/spike", target: spike } }],
        force: true,
      });
  });

  it("deletes the selected branches in one request, confirms only those that would lose commits and restores all with Undo unselected", async () => {
    const environment = await refsEnvironment();
    const lost = {
      commits: [{ oid: spike, subject: "Try refs index" }],
      count: 1,
    };
    environment.keepUnmerged("feature/spike", lost);
    environment.keepUnmerged("feature/wip", lost);
    const screen = await renderBranches(environment);
    const tree = screen.getByRole("tree", { name: "Branches" });
    await tree.getByRole("treeitem", { name: "feature/merged" }).click();
    await tree
      .getByRole("treeitem", { name: "feature/wip" })
      .click({ modifiers: ["Shift"] });
    await tree
      .getByRole("treeitem", { name: "feature/done" })
      .click({ modifiers: ["ControlOrMeta"] });

    await userEvent.keyboard("{Delete}");
    await expect
      .poll(() => environment.requested)
      .toHaveBeenCalledWith("delete", {
        ...scope,
        branches: [
          { local: { name: "feature/merged", target: main } },
          { local: { name: "feature/spike", target: spike } },
          { local: { name: "feature/wip", target: spike } },
        ],
        force: false,
      });
    await expect
      .element(screen.getByText("Deleted feature/merged"))
      .toBeVisible();
    const warning = screen.getByRole("alertdialog", {
      name: "Delete 2 branches?",
    });
    await expect
      .element(warning)
      .toHaveTextContent(
        "These branches have commits that exist nowhere else.feature/spikefeature/wip",
      );
    await warning.getByRole("button", { name: "Delete", exact: true }).click();
    await expect
      .poll(() => environment.requested)
      .toHaveBeenLastCalledWith("delete", {
        ...scope,
        branches: [
          { local: { name: "feature/spike", target: spike } },
          { local: { name: "feature/wip", target: spike } },
        ],
        force: true,
      });
    await expect
      .element(tree.getByRole("treeitem", { name: "feature/wip" }))
      .not.toBeInTheDocument();

    await expect.element(screen.getByText("Deleted 3 branches")).toBeVisible();
    await screen.getByRole("button", { name: "Undo" }).click();
    for (const name of ["feature/merged", "feature/spike", "feature/wip"])
      await expect.element(tree.getByRole("treeitem", { name })).toBeVisible();
    await expect
      .element(tree.getByRole("treeitem", { name: "feature/wip" }))
      .toHaveAttribute("aria-selected", "false");
  });

  it("confirms before deleting a branch locally and on its remote", async () => {
    const environment = await refsEnvironment();
    const screen = await renderBranches(environment);
    await screen
      .getByRole("treeitem", { name: "feature/merged" })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Delete" }).click();
    await screen.getByRole("menuitem", { name: "Both" }).click();

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
        branches: [
          {
            local: { name: "feature/merged", target: main },
            remote: { name: "feature/merged", remote: "origin", target: main },
          },
        ],
        force: false,
      });
    await expect.element(confirmation).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Undo" }))
      .not.toBeInTheDocument();
  });

  it("reports a remote that refused the deletion and offers Undo for the branches it did delete", async () => {
    const environment = await refsEnvironment();
    environment.failRemotesNext({
      _tag: "BranchMoved",
      name: "origin/feature/merged",
    });
    const screen = await renderBranches(environment);
    const tree = screen.getByRole("tree", { name: "Branches" });
    await tree.getByRole("treeitem", { name: "feature/merged" }).click();
    await tree
      .getByRole("treeitem", { name: "feature/done" })
      .click({ modifiers: ["ControlOrMeta"] });
    await tree
      .getByRole("treeitem", { name: "feature/done" })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Delete" }).click();
    await screen.getByRole("menuitem", { name: "Both" }).click();
    await screen
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    await expect
      .element(
        screen.getByText("origin/feature/merged changed since it was shown."),
      )
      .toBeVisible();
    const done = tree.getByRole("treeitem", { name: "feature/done" });
    await expect.element(done).not.toBeInTheDocument();
    await expect
      .element(tree.getByRole("treeitem", { name: "feature/merged" }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Undo" }).click();
    await expect.element(done).toBeVisible();
    await expect
      .poll(() => environment.requested)
      .toHaveBeenCalledWith("create", {
        ...scope,
        name: "feature/done",
        startPoint: main,
      });
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
      .toHaveTextContent("DeleteIn another worktree");
  });

  it("creates a lightweight tag from the graph menu and deletes it from the sidebar", async () => {
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

    await expect
      .element(screen.getByText("Lightweight", { exact: true }))
      .toBeVisible();
    await userEvent.keyboard("v1.0{Enter}");
    const tag = screen.getByRole("treeitem", { name: "v1.0" });
    await expect.element(tag).toBeVisible();
    expect(environment.requested).toHaveBeenCalledWith("createTag", {
      ...scope,
      name: "v1.0",
      target: spike,
    });

    await tag.click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Delete" }).click();
    await screen.getByRole("menuitem", { name: /^Local/ }).click();
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
      local: { object: spike },
    });
  });

  it("creates an annotated tag from a message and shows its annotation under the row", async () => {
    const environment = await refsEnvironment();
    const screen = await renderBranches(environment, spike);
    await screen
      .getByRole("button", { name: `Commit ${spike.slice(0, 7)}` })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Create tag here…" }).click();

    await userEvent.keyboard("v2.0");
    await screen
      .getByRole("textbox", { name: "Tag message" })
      .fill("Release 2.0");
    await expect
      .element(screen.getByText("Annotated", { exact: true }))
      .toBeVisible();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    await expect
      .element(screen.getByRole("treeitem", { name: "v2.0" }))
      .toBeVisible();
    expect(environment.requested).toHaveBeenCalledWith("createTag", {
      ...scope,
      name: "v2.0",
      target: spike,
      message: "Release 2.0",
    });
    const details = screen.getByRole("region", { name: "v2.0 details" });
    await expect.element(details).toHaveTextContent("Release 2.0");
    await expect.element(details).toHaveTextContent("Tag author");
    await expect
      .element(details)
      .toHaveTextContent(
        `tag ${annotated.slice(0, 7)} → commit ${spike.slice(0, 7)}`,
      );
  });

  it("pushes the selected tags to a remote and deletes one there after confirming", async () => {
    const environment = await refsEnvironment();
    const screen = await renderBranches(environment);
    await screen.getByRole("treeitem", { name: "Tags" }).click();
    await screen.getByRole("treeitem", { name: "v0.9" }).click();
    await screen
      .getByRole("treeitem", { name: "v0.8" })
      .click({ modifiers: ["ControlOrMeta"] });

    await screen
      .getByRole("treeitem", { name: "v0.8" })
      .click({ button: "right" });
    await screen
      .getByRole("menuitem", { name: "Push 2 tags to origin" })
      .click();
    await expect
      .element(screen.getByText("Pushed v0.9 and v0.8 to origin"))
      .toBeVisible();
    expect(environment.requested).toHaveBeenCalledWith("pushTags", {
      ...scope,
      remote: "origin",
      tags: ["v0.9", "v0.8"],
    });

    await screen.getByRole("treeitem", { name: "v0.9" }).click();
    await screen
      .getByRole("treeitem", { name: "v0.9" })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Delete" }).click();
    await screen.getByRole("menuitem", { name: "On origin…" }).click();
    await screen
      .getByRole("alertdialog", { name: "Delete tag v0.9 on origin?" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    expect(environment.requested).toHaveBeenLastCalledWith("deleteTag", {
      ...scope,
      name: "v0.9",
      remote: { remote: "origin", object: main },
    });
    await expect
      .element(screen.getByText("Deleted v0.9 on origin"))
      .toBeVisible();
  });

  it("runs a graph tag label's menu through the sidebar instead of the commit menu", async () => {
    const environment = await refsEnvironment();
    const screen = await renderBranches(environment, spike, undefined, true);

    await screen
      .getByRole("button", { name: "Copy v0.9" })
      .click({ button: "right" });
    await expect
      .element(screen.getByRole("menuitem", { name: "Create tag here…" }))
      .not.toBeInTheDocument();
    await screen.getByRole("menuitem", { name: "Delete" }).click();
    await screen.getByRole("menuitem", { name: /^Local/ }).click();
    await screen
      .getByRole("alertdialog", { name: "Delete tag v0.9?" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    await expect
      .poll(() => environment.requested)
      .toHaveBeenCalledWith("deleteTag", {
        ...scope,
        name: "v0.9",
        local: { object: main },
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

type UnmergedCommits = Omit<UnmergedBranch, "branch">;

type RefFailure = RouteFailure<
  | (typeof RepositoryBranchesApi)[keyof typeof RepositoryBranchesApi]
  | typeof RepositoryTagsApi.delete
>;

async function refsEnvironment() {
  const requested = vi.fn<(route: RefRoute, command: unknown) => void>();
  const rejections = new Map<RefRoute, RefFailure>();
  const unmergedBranches = new Map<string, UnmergedCommits>();
  let remoteFailure: RepositoryBranchesDeleted["failure"];
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
    reply("delete", RepositoryBranchesApi.delete, (command) => {
      const unmerged = command.force
        ? []
        : command.branches.flatMap((branch) => {
            const lost = unmergedBranches.get(branch.local?.name ?? "");
            return lost === undefined ? [] : [{ branch, ...lost }];
          });
      const failure = remoteFailure;
      remoteFailure = undefined;
      const deleted = command.branches.filter(
        (branch) =>
          !unmerged.some((entry) => entry.branch === branch) &&
          (failure === undefined || branch.remote === undefined),
      );
      const removed = (name: string, remote?: string) =>
        deleted.some((branch) =>
          remote === undefined
            ? branch.local?.name === name
            : branch.remote?.name === name && branch.remote.remote === remote,
        );
      branches((all) => all.filter(({ name }) => !removed(name)));
      current = {
        ...current,
        remoteBranches: current.remoteBranches.filter(
          ({ name, remote }) => !removed(name, remote),
        ),
      };
      return failure === undefined
        ? { deleted, unmerged }
        : { deleted, unmerged, failure };
    }),
    reply("createTag", RepositoryTagsApi.create, (command) => {
      const tag = {
        name: command.name,
        target: command.target,
        ...(command.message === undefined ? {} : { object: annotated }),
      };
      current = { ...current, tags: [...current.tags, tag] };
      return tag;
    }),
    reply("deleteTag", RepositoryTagsApi.delete, (command) => {
      current = {
        ...current,
        tags: current.tags.filter(({ name }) => name !== command.name),
      };
      return { name: command.name };
    }),
    reply("pushTags", RepositoryPushApi.pushTags, ({ remote, tags }) => ({
      remote,
      pushed: tags,
      upToDate: [],
    })),
    respond(RepositoryTagsApi.annotation, async ({ name }) => ({
      name,
      object: annotated,
      target: spike,
      tagger: { name: "Tag author", date: "2026-09-25T17:40:00+03:00" },
      message: "Release 2.0",
      signed: false,
    })),
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
    keepUnmerged: (name: string, lost: UnmergedCommits) =>
      unmergedBranches.set(name, lost),
    failRemotesNext: (
      failure: NonNullable<RepositoryBranchesDeleted["failure"]>,
    ) => {
      remoteFailure = failure;
    },
    environment: { requests },
  };
}

function renderBranches(
  environment: Awaited<ReturnType<typeof refsEnvironment>>,
  createBranchAt?: string,
  onBranchRenamed: (rename: BranchRename) => void = () => undefined,
  tagLabel = false,
) {
  return render(
    <RepositoryScopeProvider
      scope={repositoryScope({ ...scope, logicalRepositoryId: repositoryId })}
    >
      <BranchWorkspace
        createBranchAt={createBranchAt}
        onBranchRenamed={onBranchRenamed}
        tagLabel={tagLabel}
      />
    </RepositoryScopeProvider>,
    { environment: environment.environment },
  );
}

function BranchWorkspace({
  createBranchAt,
  onBranchRenamed,
  tagLabel,
}: {
  readonly createBranchAt: string | undefined;
  readonly onBranchRenamed: (rename: BranchRename) => void;
  readonly tagLabel: boolean;
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
          {tagLabel ? (
            <div>
              <CommitRefPill label={{ name: "v0.9", type: "tag" }} />
            </div>
          ) : (
            <button type="button">Commit {createBranchAt.slice(0, 7)}</button>
          )}
        </CommitActionMenu>
      )}
      <div style={{ height: 520, width: 320 }}>
        <BranchesSidebar onBranchRenamed={onBranchRenamed} />
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
      { name: "feature/done", target: main },
      { name: "feature/spike", target: spike },
      { name: "feature/wip", target: spike },
      { name: "topic", target: main, worktreePath: topicPath },
    ],
    remoteBranches: [
      { name: "feature/merged", remote: "origin", target: main },
      { name: "main", remote: "origin", target: main },
      { name: "release", remote: "origin", target: main },
    ],
    remoteProviders: [{ remote: "origin", provider: "git" }],
    tags: [
      { name: "v0.9", target: main },
      { name: "v0.8", target: spike },
    ],
    worktrees: mainAndTopicWorktrees(),
  });
}
