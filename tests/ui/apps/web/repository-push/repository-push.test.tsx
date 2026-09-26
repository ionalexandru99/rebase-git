import {
  type PushBranch,
  type PushRejected,
  RepositoryPushHttpApi,
} from "@rebase/contracts";
import { EnvironmentHttpRejected } from "@rebase/environment-client";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  fakeRequests,
  idleOperation,
  respond,
} from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import { NotificationsProvider } from "#web/features/notifications/notifications";
import { PushButton } from "#web/features/repository-push/components/push-button";
import { PushNotice } from "#web/features/repository-push/components/push-notice";
import { usePush } from "#web/features/repository-push/hooks/use-push";
import type { PushTarget } from "#web/features/repository-push/resolve-push-target";
import { RepositoryScopeProvider } from "#web/features/repository-scope/repository-scope-provider";

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

function Push({ target }: { readonly target: PushTarget }) {
  const push = usePush();
  return (
    <>
      <PushButton push={push} target={target} />
      <PushNotice push={push} />
    </>
  );
}

async function fixture(
  target: PushTarget,
  respondTo: (
    command: PushBranch,
    signal: AbortSignal | undefined,
  ) => Promise<PushRejected | null> = async () => null,
) {
  const pushed = vi.fn<(command: PushBranch) => void>();
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryPushHttpApi.push, async (command, { signal }) => {
      pushed(command);
      const failure = await respondTo(command, signal);
      if (failure !== null) throw new EnvironmentHttpRejected({ failure });
      return { destination: command.destination, target: reviewed };
    }),
  );
  const tree = (worktreePath: string) => (
    <NotificationsProvider>
      <RepositoryScopeProvider
        scope={repositoryScope({ ...scope, worktreePath })}
      >
        <Push target={target} />
      </RepositoryScopeProvider>
    </NotificationsProvider>
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

    await expect.poll(() => f.pushed.mock.calls.length).toBe(1);
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
    const confirmation = page.getByRole("region", {
      name: "Confirm force push",
    });
    await expect
      .element(confirmation)
      .toHaveTextContent("Overwrites 9c1e2f71 · drops 2 remote commits");
    expect(f.pushed).not.toHaveBeenCalled();
    await confirmation.getByRole("button", { name: "Force push" }).click();

    await expect
      .element(
        page.getByText(
          "Rejected: origin/feature/444-push moved since your last fetch.",
          { exact: false },
        ),
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

  it("reports a cancelled push as cancelled instead of pushed", async () => {
    await fixture(
      { branch: "spike", remotes: ["origin"] },
      (_command, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal.reason)),
        ),
    );

    await page.getByRole("button", { name: "Push spike" }).click();
    await page
      .getByRole("region", { name: "Push progress" })
      .getByRole("button", { name: "Cancel" })
      .click();

    await expect
      .element(
        page.getByText(
          "Cancelled. origin/spike reflects what reached the remote.",
        ),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Push spike" }))
      .toHaveTextContent("Push");
  });

  it("cancels the push and clears the review when the worktree changes", async () => {
    const aborted = vi.fn();
    const f = await fixture(
      tracked(3, 2),
      (_command, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => {
            aborted();
            reject(signal.reason);
          }),
        ),
    );
    const forcePush = page.getByRole("button", {
      name: /^Force push feature\/444-push/,
    });
    const confirmation = page.getByRole("region", {
      name: "Confirm force push",
    });

    await forcePush.click();
    await expect.element(confirmation).toBeVisible();
    await f.switchWorktree("/other");
    await expect.element(confirmation).not.toBeInTheDocument();

    await forcePush.click();
    await confirmation.getByRole("button", { name: "Force push" }).click();
    await expect
      .element(page.getByRole("region", { name: "Push progress" }))
      .toBeVisible();
    await f.switchWorktree("/repo");

    await expect.poll(() => aborted.mock.calls.length).toBe(1);
    await expect
      .element(page.getByRole("region", { name: "Push progress" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText("Cancelled.", { exact: false }))
      .not.toBeInTheDocument();
  });
});
