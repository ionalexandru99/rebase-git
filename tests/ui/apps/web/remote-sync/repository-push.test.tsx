import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { RepositoryPullApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import {
  type PushBranch,
  type PushRejected,
  RepositoryPushApi,
} from "#contracts/repository-push/repository-push.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  fakeRequests,
  idleOperation,
  rejected,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  commitId,
  fetchStatus,
  repositoryId,
  repositoryRefs,
  repositoryScope,
  worktree,
} from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import {
  PushButton,
  PushNotice,
  usePush,
} from "#web/features/remote-sync/push.tsx";
import type { PushTarget } from "#web/features/remote-sync/push-target.ts";
import { RemoteSync } from "#web/features/remote-sync/remote-sync.tsx";
import type { RequestOptions } from "#web/platform/query/environment-context.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const reviewed = "9c1e2f71".padEnd(40, "0");
const scope = { repositoryId: "repo", worktreePath: "/repo" };

function tracked(ahead: number, behind: number): PushTarget {
  return {
    branch: "feature/444-push",
    remotes: ["origin", "upstream"],
    upstream: {
      destination: { remote: "origin", branch: "feature/444-push" },
      ahead,
      behind,
      gone: false,
      remoteOid: reviewed,
    },
  };
}

function PushControls({ target }: { readonly target: PushTarget }) {
  const push = usePush();
  return (
    <>
      <PushButton push={push} target={target} operationBusy={false} />
      <PushNotice push={push} />
    </>
  );
}

function pendingPush(aborted: () => void = () => {}) {
  return (_command: PushBranch, { signal }: RequestOptions) =>
    new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        aborted();
        reject(signal.reason);
      });
    });
}

async function fixture(
  target: PushTarget,
  respondTo: (
    command: PushBranch,
    options: RequestOptions,
  ) => Promise<PushRejected | null> = async () => null,
) {
  const pushed = vi.fn<(command: PushBranch) => void>();
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryPushApi.push, async (command, options) => {
      pushed(command);
      const failure = await respondTo(command, options);
      if (failure !== null) throw rejected(failure);
      return { destination: command.destination, target: reviewed };
    }),
  );
  const tree = (worktreePath: string) => (
    <RepositoryScopeProvider
      scope={repositoryScope({ ...scope, worktreePath })}
    >
      <PushControls target={target} />
    </RepositoryScopeProvider>
  );
  const view = await render(tree(scope.worktreePath), {
    environment: { requests },
  });
  return {
    pushed,
    switchWorktree: (worktreePath: string) => view.rerender(tree(worktreePath)),
  };
}

describe("repository push", () => {
  it("pushes a branch without an upstream to origin and tracks it", async () => {
    const f = await fixture({ branch: "spike", remotes: ["fork", "origin"] });

    await page.getByRole("button", { name: "Push spike" }).click();

    await expect
      .element(page.getByText("Pushed", { exact: true }))
      .toBeVisible();
    expect(f.pushed).toHaveBeenCalledWith({
      ...scope,
      branch: "spike",
      destination: { remote: "origin", branch: "spike" },
      setUpstream: true,
      mode: { _tag: "FastForward" },
    });
  });

  it("asks before replacing a diverged branch and reports a moved remote without retrying", async () => {
    const f = await fixture(tracked(3, 2), async () => ({
      _tag: "PushRejected",
      reason: "LeaseRejected",
      detail: "The remote branch moved after you reviewed it.",
    }));

    await page
      .getByRole("button", { name: /^Force push feature\/444-push/ })
      .click();
    const confirmation = page.getByRole("alertdialog", { name: "Force push?" });
    await expect
      .element(confirmation)
      .toHaveTextContent(
        "Commits on the remote that you don't have will be lost.",
      );
    expect(f.pushed).not.toHaveBeenCalled();
    await confirmation.getByRole("button", { name: "Force push" }).click();

    await expect
      .element(
        page.getByText("The remote branch moved since your last fetch.", {
          exact: false,
        }),
      )
      .toBeVisible();
    expect(f.pushed).toHaveBeenCalledOnce();
    expect(f.pushed).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: { _tag: "ForceWithLease", expectedOid: reviewed },
      }),
    );
  });

  it("pushes while the browser reports that it is offline", async () => {
    const f = await fixture({ branch: "spike", remotes: ["origin"] });
    window.dispatchEvent(new Event("offline"));
    try {
      await page.getByRole("button", { name: "Push spike" }).click();

      await expect.poll(() => f.pushed.mock.calls.length).toBe(1);
    } finally {
      window.dispatchEvent(new Event("online"));
    }
  });

  it("cancels a running push from its notification without reporting a failure", async () => {
    await fixture({ branch: "spike", remotes: ["origin"] }, pendingPush());
    const progress = page.getByRole("dialog", { name: "Pushing" });

    await page.getByRole("button", { name: "Push spike" }).click();
    await expect.element(progress).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect
      .element(page.getByRole("button", { name: "Push spike" }))
      .toBeEnabled();
    await expect.element(progress).not.toBeInTheDocument();
    await expect
      .element(page.getByText("The request was cancelled."))
      .not.toBeInTheDocument();
  });

  it("keeps a running force push in its card across worktree changes and stops it from there", async () => {
    const aborted = vi.fn();
    const f = await fixture(tracked(3, 2), pendingPush(aborted));
    const forcePush = page.getByRole("button", {
      name: /^Force push feature\/444-push/,
    });
    const confirmation = page.getByRole("alertdialog", { name: "Force push?" });
    const progress = confirmation.getByRole("button", {
      name: "Force pushing",
    });

    await forcePush.click();
    await expect.element(confirmation).toBeVisible();
    await f.switchWorktree("/other");
    await expect.element(confirmation).not.toBeInTheDocument();

    await forcePush.click();
    await confirmation.getByRole("button", { name: "Force push" }).click();
    await expect.element(progress).toBeVisible();
    await f.switchWorktree("/repo");

    await expect.element(progress).toBeVisible();
    expect(aborted).not.toHaveBeenCalled();

    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect.element(confirmation).not.toBeInTheDocument();
    expect(aborted).toHaveBeenCalledOnce();
  });

  it("keeps a running push when the graph toolbar closes", async () => {
    const aborted = vi.fn();
    const requests = fakeRequests(
      idleOperation,
      respond(RepositoryRefsApi.read, async () =>
        repositoryRefs({
          branches: [
            { name: "spike", target: commitId, worktreePath: "/repo" },
          ],
          remoteProviders: [{ remote: "origin", provider: "git" }],
          worktrees: [worktree("/repo", "spike")],
        }),
      ),
      respond(RepositoryPullApi.fetchStatus, async () => fetchStatus()),
      respond(RepositoryPushApi.push, (command, options) =>
        pendingPush(aborted)(command, options),
      ),
    );
    const tree = (toolbar: boolean) => (
      <RepositoryScopeProvider
        scope={repositoryScope({ repositoryId, worktreePath: "/repo" })}
      >
        <RemoteSync>{(actions) => (toolbar ? actions : null)}</RemoteSync>
      </RepositoryScopeProvider>
    );
    const view = await render(tree(true), {
      environment: { requests },
    });
    const pushButton = page.getByRole("button", { name: "Push spike" });
    const progress = page.getByRole("dialog", { name: "Pushing" });

    await pushButton.click();
    await expect.element(progress).toBeVisible();
    await view.rerender(tree(false));

    await expect.element(pushButton).not.toBeInTheDocument();
    await expect.element(progress).toBeVisible();
    expect(aborted).not.toHaveBeenCalled();
  });
});
