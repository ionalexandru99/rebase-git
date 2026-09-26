import {
  RepositoryBranchesHttpApi,
  type RepositoryRefs,
  RepositoryRefsHttpApi,
  type RouteFailure,
  type RouteInput,
  type RouteSuccess,
} from "@rebase/contracts";
import {
  EnvironmentHttpRejected,
  type RequestableEnvironmentHttpRoute,
} from "@rebase/environment-client";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  fakeRequests,
  idleOperation,
  respond,
} from "#tests-ui/runtime/fake-requests";
import { fakeRpc } from "#tests-ui/runtime/fake-rpc";
import { render } from "#tests-ui/runtime/render";
import { useCreateBranchHere } from "#web/features/branch-management/hooks/use-create-branch-here";
import type { BranchRename } from "#web/features/branches-sidebar/branch-editing/hooks/use-branch-editing";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar";
import { CommitCommandMenu } from "#web/features/commit-commands/commit-command-menu";
import type { GraphCommandDefinition } from "#web/features/commit-commands/graph-command.contract";
import { NotificationsProvider } from "#web/features/notifications/notifications";
import { useRefActivation } from "#web/features/repository-refs/hooks/use-ref-activation";
import { useRepositoryRefs } from "#web/features/repository-refs/hooks/use-repository-refs";
import { RepositoryScopeProvider } from "#web/features/repository-scope/repository-scope-provider";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const mainPath = "/repo";
const topicPath = "/repo/.worktrees/topic";
const main = "a".repeat(40);
const spike = "b".repeat(40);
const scope = { repositoryId, worktreePath: mainPath };

type BranchRoute =
  | keyof typeof RepositoryBranchesHttpApi
  | keyof typeof RepositoryRefsHttpApi;

describe("branch editing", () => {
  beforeEach(() => localStorage.setItem("rebase:branches-view:v1", "linear"));

  it("creates a branch at a commit and switches to it", async () => {
    const environment = await branchEnvironment();
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
    await vi.waitFor(() =>
      expect(environment.requested).toHaveBeenCalledWith("checkout", {
        ...scope,
        target: { _tag: "LocalBranch", name: "feature/next" },
      }),
    );
    await expect
      .element(
        screen.getByRole("treeitem", { name: "feature/next, current branch" }),
      )
      .toBeVisible();
  });

  it("renames the active branch with F2 and cancels with Escape", async () => {
    const environment = await branchEnvironment();
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
    const environment = await branchEnvironment();
    const screen = await renderBranches(environment);
    await screen.getByRole("treeitem", { name: "feature/merged" }).click();

    await userEvent.keyboard("{Delete}");
    await vi.waitFor(() =>
      expect(environment.requested).toHaveBeenCalledWith("delete", {
        ...scope,
        force: false,
        local: { name: "feature/merged", target: main },
      }),
    );
    const merged = screen.getByRole("treeitem", { name: "feature/merged" });
    await expect.element(merged).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Undo" }).click();
    await expect.element(merged).toBeVisible();
    await vi.waitFor(() =>
      expect(environment.requested).toHaveBeenCalledWith("create", {
        ...scope,
        name: "feature/merged",
        startPoint: main,
        track: { name: "feature/merged", remote: "origin" },
      }),
    );
    expect(environment.requested).not.toHaveBeenCalledWith(
      "checkout",
      expect.anything(),
    );
  });

  it("asks in a warning notification before deleting commits that exist only on the branch", async () => {
    const environment = await branchEnvironment();
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
    await vi.waitFor(() =>
      expect(environment.requested).toHaveBeenLastCalledWith("delete", {
        ...scope,
        force: true,
        local: { name: "feature/spike", target: spike },
      }),
    );
  });

  it("confirms before deleting a branch locally and on its remote", async () => {
    const environment = await branchEnvironment();
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
    await vi.waitFor(() =>
      expect(environment.requested).toHaveBeenCalledWith("delete", {
        ...scope,
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
    const screen = await renderBranches(await branchEnvironment());
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
    const environment = await branchEnvironment();
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
    await vi.waitFor(() =>
      expect(environment.requested).toHaveBeenCalledWith("setUpstream", {
        ...scope,
        name: "feature/spike",
        upstream: { name: "main", remote: "origin" },
      }),
    );
  });
  it("shows an upstream failure after the picker closes", async () => {
    const environment = await branchEnvironment();
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
});

type BranchFailure = RouteFailure<
  (typeof RepositoryBranchesHttpApi)[keyof typeof RepositoryBranchesHttpApi]
>;

async function branchEnvironment() {
  const requested = vi.fn<(route: BranchRoute, command: unknown) => void>();
  const rejections = new Map<BranchRoute, BranchFailure>();
  const reply = <Route extends RequestableEnvironmentHttpRoute>(
    name: BranchRoute,
    route: Route,
    answer: (command: RouteInput<Route>) => RouteSuccess<Route>,
  ) =>
    respond(route, async (command) => {
      requested(name, command);
      const failure = rejections.get(name);
      rejections.delete(name);
      if (failure !== undefined) throw new EnvironmentHttpRejected({ failure });
      return answer(command);
    });
  const requests = fakeRequests(
    idleOperation,
    reply("create", RepositoryBranchesHttpApi.create, ({ name }) => ({
      name,
      target: main,
    })),
    reply("rename", RepositoryBranchesHttpApi.rename, (command) => ({
      branch: { name: command.newName, target: spike },
      previousName: command.name,
    })),
    reply("delete", RepositoryBranchesHttpApi.delete, ({ local, remote }) => ({
      ...(local === undefined ? {} : { local }),
      ...(remote === undefined ? {} : { remote }),
    })),
    reply("setUpstream", RepositoryBranchesHttpApi.setUpstream, ({ name }) => ({
      name,
      target: main,
    })),
    reply("checkout", RepositoryRefsHttpApi.checkout, (command) => ({
      head: { branch: command.target.name, commit: spike },
      stash: "none" as const,
      worktreePath: command.worktreePath,
    })),
  );
  return {
    requested,
    rejectNext: (route: BranchRoute, failure: BranchFailure) =>
      rejections.set(route, failure),
    environment: { requests, rpc: await fakeRpc(async () => refs()) },
  };
}

function renderBranches(
  environment: Awaited<ReturnType<typeof branchEnvironment>>,
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
  const repositoryRefs = useRepositoryRefs(repositoryId, repositoryId);
  const activation = useRefActivation(repositoryRefs);
  const creation = useCreateBranchHere();
  return (
    <>
      {createBranchAt === undefined ? null : (
        <CommitAt commands={creation.commands} oid={createBranchAt} />
      )}
      <div style={{ height: 520, width: 320 }}>
        <BranchesSidebar
          activation={activation}
          activeWorktreePath={mainPath}
          createRequest={creation.request}
          focusRequest={0}
          onBranchRenamed={onBranchRenamed}
          repositoryRefs={repositoryRefs}
        />
      </div>
    </>
  );
}

function CommitAt({
  commands,
  oid,
}: {
  readonly commands: readonly GraphCommandDefinition[];
  readonly oid: string;
}) {
  return (
    <CommitCommandMenu
      commands={commands}
      context={{
        invokingOid: oid,
        selectedOids: [oid],
        connected: true,
        readable: true,
        writable: true,
      }}
      restoreFocus={() => undefined}
      run={async (command) => {
        await command();
      }}
    >
      <button type="button">Commit {oid.slice(0, 7)}</button>
    </CommitCommandMenu>
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
