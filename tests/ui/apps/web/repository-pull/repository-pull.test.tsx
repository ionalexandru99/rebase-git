import type { PullHttpFailure, RepositoryFreshness } from "@rebase/contracts";
import {
  EnvironmentHttpRejected,
  type EnvironmentRequestClient,
  environmentHttpRoutesClient,
} from "@rebase/environment-client";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import { NotificationsProvider } from "#web/features/notifications/index";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/index";
import { RepositoryPull } from "#web/features/repository-pull/index";
import { RepositoryScopeProvider } from "#web/features/repository-scope/index";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const freshness: RepositoryFreshness = {
  revision: 1,
  fetching: false,
  stale: false,
  defaultIntervalSeconds: 300,
  setting: { _tag: "Inherit" },
};
const history: RepositoryHistorySnapshot = {
  revision: 0,
  historyRevision: 0,
  status: "ready",
  freshness,
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
        scope={repositoryScope({ repositoryId, requests })}
      >
        <RepositoryPull.Provider
          reader={{
            fetch,
            getSnapshot: () => history,
            subscribe: () => () => {},
          }}
          activeBranch="main"
          incoming={0}
        >
          <RepositoryPull.Button />
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
