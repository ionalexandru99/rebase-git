import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  type PullFailure,
  type RepositoryFetchStatus,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  CommitGraphFixture,
  history as graphHistory,
  historyReader,
} from "#tests-support/commit-graph-fixture.tsx";
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
  upstream,
  worktree,
} from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { RemoteSync } from "#web/features/remote-sync/remote-sync.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const status = fetchStatus();

describe("repository pull", () => {
  it("fetches before fast-forwarding the branch", async () => {
    const f = await fixture();
    await f.pull();
    await expect
      .poll(() => f.requested)
      .toHaveBeenCalledWith({
        repositoryId,
        worktreePath: "/repo",
        branch: "main",
      });
    expect(f.fetch.mock.invocationCallOrder[0]).toBeLessThan(
      f.requested.mock.invocationCallOrder[0] ?? 0,
    );
    await expect
      .element(page.getByRole("button", { name: "Pull" }))
      .toBeEnabled();
    await expect.element(page.getByRole("status")).not.toBeInTheDocument();
  });

  it("does not pull when the fetch fails", async () => {
    const f = await fixture({ fetchFails: true });
    await f.pull();
    await expect.poll(() => f.fetch.mock.calls.length).toBe(1);
    await expect
      .element(page.getByRole("button", { name: "Pull" }))
      .toBeEnabled();
    await expect
      .element(page.getByText("Git could not fetch from the remote."))
      .toBeVisible();
    expect(page.getByText("Couldn't pull").elements()).toHaveLength(0);
    expect(f.requested).not.toHaveBeenCalled();
  });

  it("pulls the active branch from the graph toolbar and holds fetch until it finishes", async () => {
    const reader = historyReader({ commits: graphHistory(2), status: "ready" });
    const fetched = Promise.withResolvers<RepositoryFetchStatus>();
    const pulled = vi.fn<(command: unknown) => void>();
    const finished = Promise.withResolvers<void>();
    const requests = fakeRequests(
      idleOperation,
      respond(RepositoryRefsApi.read, async () => refs(3)),
      respond(RepositoryPullApi.fetchStatus, async () => status),
      respond(RepositoryPullApi.fetch, () => fetched.promise),
      respond(RepositoryPullApi.pull, async (command) => {
        pulled(command);
        await finished.promise;
        return { outcome: "FastForwarded" as const };
      }),
    );
    await render(
      <div style={{ height: 520, width: 900 }}>
        <RepositoryScopeProvider scope={repositoryScope({ repositoryId })}>
          <RemoteSync>
            {(actions) => (
              <CommitGraphFixture
                reader={reader}
                repositoryName="rebase-test"
                roots={[{ name: "main", oid: "0".repeat(40), type: "branch" }]}
                toolbarActions={actions}
              />
            )}
          </RemoteSync>
        </RepositoryScopeProvider>
      </div>,
      { environment: { requests } },
    );
    await page.getByRole("button", { name: "Pull 3 incoming commits" }).click();
    await expect
      .element(page.getByRole("button", { name: "Fetching", exact: true }))
      .toBeDisabled();
    fetched.resolve(status);
    await expect
      .poll(() => pulled)
      .toHaveBeenCalledWith({
        repositoryId,
        worktreePath: "/repo",
        branch: "main",
      });
    await expect
      .element(page.getByRole("button", { name: "Pulling" }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Fetch", exact: true }))
      .toBeDisabled();
    finished.resolve();
    await expect
      .element(page.getByRole("button", { name: "Pull 3 incoming commits" }))
      .toBeEnabled();
  });

  it("shows the fetch and then the pull progress in one toast that turns into the result", async () => {
    const fetched = Promise.withResolvers<RepositoryFetchStatus>();
    const pulled = Promise.withResolvers<{ outcome: "FastForwarded" }>();
    const requests = fakeRequests(
      idleOperation,
      respond(RepositoryRefsApi.read, async () => refs(1)),
      respond(RepositoryPullApi.fetchStatus, async () => status),
      respond(RepositoryPullApi.fetch, (_input, { progress }) => {
        progress?.(60);
        return fetched.promise;
      }),
      respond(RepositoryPullApi.pull, (_input, { progress }) => {
        progress?.(30);
        return pulled.promise;
      }),
    );
    await render(
      <RepositoryScopeProvider scope={repositoryScope({ repositoryId })}>
        <RemoteSync>{(actions) => actions}</RemoteSync>
      </RepositoryScopeProvider>,
      { environment: { requests } },
    );

    await page.getByRole("button", { name: "Pull 1 incoming commit" }).click();
    await expect
      .element(page.getByRole("progressbar", { name: "Fetching" }))
      .toHaveAttribute("aria-valuenow", "60");
    fetched.resolve(status);
    await expect
      .element(page.getByRole("progressbar", { name: "Pulling" }))
      .toHaveAttribute("aria-valuenow", "30");
    pulled.resolve({ outcome: "FastForwarded" });

    await expect.element(page.getByText("Pulled main")).toBeVisible();
    await expect.element(page.getByRole("progressbar")).not.toBeInTheDocument();
  });

  it.each<[PullFailure, string]>([
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
  fetchFails = false,
  failure,
}: {
  readonly fetchFails?: boolean;
  readonly failure?: PullFailure;
} = {}) {
  const fetch = vi.fn(async () => {
    if (fetchFails)
      throw rejected({
        _tag: "FetchFailed" as const,
        reason: "Failed" as const,
      });
    return status;
  });
  const requested = vi.fn();
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryRefsApi.read, async () => refs(0)),
    respond(RepositoryPullApi.fetchStatus, async () => status),
    respond(RepositoryPullApi.fetch, fetch),
    respond(RepositoryPullApi.pull, async (command) => {
      requested(command);
      if (failure !== undefined) throw rejected(failure);
      return { outcome: "FastForwarded" as const };
    }),
  );
  await render(
    <RepositoryScopeProvider scope={repositoryScope({ repositoryId })}>
      <RemoteSync>{(actions) => actions}</RemoteSync>
    </RepositoryScopeProvider>,
    { environment: { requests } },
  );
  return {
    fetch,
    requested,
    pull: () => page.getByRole("button", { name: "Pull" }).click(),
  };
}

function refs(behind: number) {
  return repositoryRefs({
    branches: [
      {
        name: "main",
        target: commitId,
        worktreePath: "/repo",
        upstream: upstream("origin/main", { behind }),
      },
    ],
    worktrees: [worktree("/repo", "main")],
  });
}
