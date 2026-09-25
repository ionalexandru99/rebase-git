import type { PushBranch, PushRejected } from "@rebase/contracts";
import {
  EnvironmentHttpRejected,
  type EnvironmentRequestClient,
  environmentHttpRoutesClient,
} from "@rebase/environment-client";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { NotificationsProvider } from "#web/features/notifications/index";
import {
  type PushTarget,
  RepositoryPush,
} from "#web/features/repository-push/index";
import { RepositoryScopeProvider } from "#web/features/repository-scope/index";

const runtime = ManagedRuntime.make(Layer.empty);
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

async function fixture(
  target: PushTarget,
  respond: (command: PushBranch) => PushRejected | null = () => null,
) {
  const requests = vi.fn<(command: PushBranch) => void>();
  const client: EnvironmentRequestClient = (routes, errors) =>
    environmentHttpRoutesClient(routes, (_route, command) => {
      const request = command as unknown as PushBranch;
      requests(request);
      const failure = respond(request);
      return failure === null
        ? Effect.succeed({
            destination: request.destination,
            target: reviewed,
          } as never)
        : Effect.fail(
            errors.response(
              new EnvironmentHttpRejected({ failure, status: 409 }) as never,
            ),
          );
    });
  await render(
    <NotificationsProvider>
      <RepositoryScopeProvider
        scope={{
          target: {
            ...scope,
            requests: client,
            changes: { subscribe: () => () => {} },
            runtime,
          },
          connected: true,
          writable: true,
        }}
      >
        <RepositoryPush.Provider>
          <RepositoryPush.Button target={target} disabled={false} />
          <RepositoryPush.Notice />
        </RepositoryPush.Provider>
      </RepositoryScopeProvider>
    </NotificationsProvider>,
  );
  return { requests };
}

describe("repository push", () => {
  it("pushes a branch without an upstream to origin and tracks it", async () => {
    const f = await fixture({ branch: "spike", remotes: ["fork", "origin"] });

    await page.getByRole("button", { name: "Push spike" }).click();

    await expect.poll(() => f.requests.mock.calls.length).toBe(1);
    expect(f.requests).toHaveBeenCalledWith({
      ...scope,
      branch: "spike",
      destination: { remote: "origin", branch: "spike" },
      setUpstream: true,
      mode: { _tag: "FastForward" },
    });
  });

  it("asks before replacing a diverged branch and reports a moved remote without retrying", async () => {
    const f = await fixture(tracked(3, 2), () => ({
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
    expect(f.requests).not.toHaveBeenCalled();
    await confirmation.getByRole("button", { name: "Force push" }).click();

    await expect
      .element(
        page.getByText(
          "Rejected: origin/feature/444-push moved since your last fetch.",
          { exact: false },
        ),
      )
      .toBeVisible();
    expect(f.requests).toHaveBeenCalledOnce();
    expect(f.requests).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: { _tag: "ForceWithLease", expectedOid: reviewed },
      }),
    );
  });
});
