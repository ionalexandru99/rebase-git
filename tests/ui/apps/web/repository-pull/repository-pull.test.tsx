import type { PullHttpFailure, RepositoryFreshness } from "@rebase/contracts";
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
  RepositoryPull,
  useRepositoryPull,
} from "#web/features/repository-pull/index";
import { RepositoryScopeProvider } from "#web/features/repository-scope/index";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const runtime = ManagedRuntime.make(Layer.empty);
const freshness: RepositoryFreshness = {
  revision: 1,
  fetching: false,
  stale: false,
  defaultIntervalSeconds: 300,
  setting: { _tag: "Inherit" },
};

describe("repository pull", () => {
  it("fetches before fast-forwarding the branch", async () => {
    const f = await fixture();
    await f.pull();
    await vi.waitFor(() =>
      expect(f.requested).toHaveBeenCalledWith({
        repositoryId,
        branch: "main",
      }),
    );
    expect(f.fetch.mock.invocationCallOrder[0]).toBeLessThan(
      f.requested.mock.invocationCallOrder[0] ?? 0,
    );
    await expect
      .element(page.getByRole("button", { name: "Pull" }))
      .toBeEnabled();
    await expect.element(page.getByRole("status")).not.toBeInTheDocument();
  });

  it("does not pull when the fetch fails", async () => {
    const f = await fixture({
      fetched: {
        ...freshness,
        failure: { _tag: "FetchFailed", reason: "Failed" },
      },
    });
    await f.pull();
    await expect
      .element(page.getByRole("button", { name: "Pull" }))
      .toBeEnabled();
    expect(f.requested).not.toHaveBeenCalled();
  });

  it.each<[PullHttpFailure, string]>([
    [
      { _tag: "PullDiverged", upstream: "origin/main" },
      "main has diverged from origin/main",
    ],
    [
      { _tag: "PullWouldOverwrite", paths: ["src/app.ts"] },
      "Local changes to src/app.ts block the pull",
    ],
    [
      { _tag: "PullWouldOverwrite", paths: ["src/app.ts", "README.md"] },
      "Local changes block the pull",
    ],
    [{ _tag: "UpstreamMissing" }, "main has no upstream"],
    [
      { _tag: "UpstreamMissing", upstream: "origin/main" },
      "origin/main was deleted",
    ],
    [{ _tag: "PullUncertain" }, "Pull may not have finished"],
  ])("explains a rejected pull: %j", async (failure, message) => {
    const f = await fixture({ failure });
    await f.pull();
    await expect.element(page.getByText(message)).toBeVisible();
  });
});

async function fixture({
  fetched = freshness,
  failure,
}: {
  readonly fetched?: RepositoryFreshness;
  readonly failure?: PullHttpFailure;
} = {}) {
  const fetch = vi.fn(async () => fetched);
  const requested = vi.fn();
  const requests: EnvironmentRequestClient = (routes, errors) =>
    environmentHttpRoutesClient(routes, (_route, command) => {
      requested(command);
      return failure === undefined
        ? Effect.succeed({ outcome: "FastForwarded" })
        : Effect.fail(
            errors.response(
              new EnvironmentHttpRejected({ failure, status: 409 }),
            ),
          );
    });
  await render(
    <NotificationsProvider>
      <RepositoryScopeProvider
        scope={{
          target: {
            repositoryId,
            worktreePath: "/repo",
            requests,
            changes: { subscribe: () => () => {} },
            runtime,
          },
          connected: true,
          writable: true,
        }}
      >
        <RepositoryPull.Provider reader={{ fetch }} incoming={0}>
          <PullButton />
          <RepositoryPull.Notice />
        </RepositoryPull.Provider>
      </RepositoryScopeProvider>
    </NotificationsProvider>,
  );
  return {
    fetch,
    requested,
    pull: () => page.getByRole("button", { name: "Pull" }).click(),
  };
}

function PullButton() {
  const pull = useRepositoryPull();
  return (
    <button
      disabled={pull?.pulling !== false}
      onClick={() => pull?.execute("main")}
      type="button"
    >
      {pull?.pulling === true ? "Pulling" : "Pull"}
    </button>
  );
}
