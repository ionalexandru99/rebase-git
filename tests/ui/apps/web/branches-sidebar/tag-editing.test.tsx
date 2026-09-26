import {
  type RepositoryRefs,
  RepositoryTagsHttpApi,
  type RouteFailure,
} from "@rebase/contracts";
import { EnvironmentHttpRejected } from "@rebase/environment-client";
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
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar";
import { useCreateRefHere } from "#web/features/branches-sidebar/hooks/use-create-ref-here";
import { CommitCommandMenu } from "#web/features/commit-commands/commit-command-menu";
import { NotificationsProvider } from "#web/features/notifications/notifications";
import { useRefActivation } from "#web/features/repository-refs/hooks/use-ref-activation";
import { useRepositoryRefs } from "#web/features/repository-refs/hooks/use-repository-refs";
import { RepositoryScopeProvider } from "#web/features/repository-scope/repository-scope-provider";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const mainPath = "/repo";
const main = "a".repeat(40);
const release = "b".repeat(40);
const scope = { repositoryId, worktreePath: mainPath };

describe("tag editing", () => {
  beforeEach(() => localStorage.setItem("rebase:branches-view:v1", "linear"));

  it("creates a tag from the graph menu and deletes it from the sidebar", async () => {
    const environment = await tagEnvironment();
    const screen = await renderTags(environment);
    await screen
      .getByRole("button", { name: `Commit ${release.slice(0, 7)}` })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Create tag here…" }).click();
    const name = screen.getByRole("textbox", {
      name: `New tag at ${release.slice(0, 7)}`,
    });
    await expect.element(name).toHaveFocus();

    await userEvent.keyboard("v1.0{Enter}");
    const tag = screen.getByRole("treeitem", { name: "v1.0" });
    await expect.element(tag).toBeVisible();
    expect(environment.requested).toHaveBeenCalledWith("create", {
      ...scope,
      name: "v1.0",
      target: release,
    });

    await tag.click({ button: "right" });
    await screen.getByRole("menuitem", { name: /Delete tag/ }).click();
    const confirmation = screen.getByRole("alertdialog", {
      name: "Delete tag v1.0",
    });
    expect(environment.requested).not.toHaveBeenCalledWith(
      "delete",
      expect.anything(),
    );
    await confirmation
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect.element(tag).not.toBeInTheDocument();
    expect(environment.requested).toHaveBeenCalledWith("delete", {
      ...scope,
      name: "v1.0",
    });
  });

  it("reports a tag that could not be deleted in a notification", async () => {
    const environment = await tagEnvironment();
    environment.rejectNext({ _tag: "RefMissing", name: "v0.9" });
    const screen = await renderTags(environment);
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

type DeleteFailure = RouteFailure<typeof RepositoryTagsHttpApi.delete>;

async function tagEnvironment() {
  const requested =
    vi.fn<(route: "create" | "delete", command: unknown) => void>();
  let rejection: DeleteFailure | undefined;
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryTagsHttpApi.create, async (command) => {
      requested("create", command);
      return { name: command.name, target: command.target };
    }),
    respond(RepositoryTagsHttpApi.delete, async (command) => {
      requested("delete", command);
      const failure = rejection;
      rejection = undefined;
      if (failure !== undefined) throw new EnvironmentHttpRejected({ failure });
      return { name: command.name, target: release };
    }),
  );
  return {
    requested,
    rejectNext: (failure: DeleteFailure) => {
      rejection = failure;
    },
    environment: { requests, rpc: await fakeRpc(async () => refs()) },
  };
}

function renderTags(environment: Awaited<ReturnType<typeof tagEnvironment>>) {
  return render(
    <NotificationsProvider>
      <RepositoryScopeProvider
        scope={repositoryScope({ ...scope, logicalRepositoryId: repositoryId })}
      >
        <TagWorkspace />
      </RepositoryScopeProvider>
    </NotificationsProvider>,
    { environment: environment.environment },
  );
}

function TagWorkspace() {
  const repositoryRefs = useRepositoryRefs(repositoryId, repositoryId);
  const activation = useRefActivation(repositoryRefs);
  const creation = useCreateRefHere();
  return (
    <>
      <CommitCommandMenu
        commands={creation.commands}
        context={{
          invokingOid: release,
          selectedOids: [release],
          connected: true,
          readable: true,
          writable: true,
        }}
        restoreFocus={() => undefined}
        run={async (command) => {
          await command();
        }}
      >
        <button type="button">Commit {release.slice(0, 7)}</button>
      </CommitCommandMenu>
      <div style={{ height: 520, width: 320 }}>
        <BranchesSidebar
          activation={activation}
          activeWorktreePath={mainPath}
          createRequest={creation.request}
          focusRequest={0}
          repositoryRefs={repositoryRefs}
        />
      </div>
    </>
  );
}

function refs(): RepositoryRefs {
  return {
    branches: [{ name: "main", target: main, worktreePath: mainPath }],
    remoteBranches: [],
    repositoryId,
    tags: [{ name: "v0.9", target: main }],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      { head: { branch: "main", commit: main }, main: true, path: mainPath },
    ],
  };
}
