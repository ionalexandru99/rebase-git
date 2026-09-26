import {
  type PullFailure,
  type RepositoryFreshness,
  RepositoryPullHttpApi,
} from "@rebase/contracts";
import { EnvironmentHttpRejected } from "@rebase/environment-client";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  CommitGraphFixture,
  history as graphHistory,
  historyReader,
} from "#tests-ui/apps/web/commit-graph/commit-graph-fixture";
import { repositoryScope } from "#tests-ui/apps/web/repository-scope/repository-scope-fixture";
import {
  fakeRequests,
  idleOperation,
  respond,
} from "#tests-ui/runtime/fake-requests";
import { render } from "#tests-ui/runtime/render";
import { NotificationsProvider } from "#web/features/notifications/notifications";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/repository-history-reader";
import { PullButton } from "#web/features/repository-pull/components/pull-button";
import { PullNotice } from "#web/features/repository-pull/components/pull-notice";
import { usePull } from "#web/features/repository-pull/hooks/use-pull";
import { RepositoryScopeProvider } from "#web/features/repository-scope/repository-scope-provider";

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
    const f = await fixture({
      fetched: {
        ...freshness,
        failure: { _tag: "FetchFailed", reason: "Failed" },
      },
    });
    await f.pull();
    await expect.poll(() => f.fetch.mock.calls.length).toBe(1);
    await expect
      .element(page.getByRole("button", { name: "Pull" }))
      .toBeEnabled();
    expect(f.requested).not.toHaveBeenCalled();
  });

  it("pulls the active branch from the graph toolbar and holds fetch until it finishes", async () => {
    const reader = historyReader({ commits: graphHistory(2), status: "ready" });
    reader.snapshot = { ...reader.snapshot, freshness };
    const fetched = Promise.withResolvers<RepositoryFreshness>();
    reader.fetch.mockReturnValue(fetched.promise);
    const pulled = vi.fn<(command: unknown) => void>();
    const finished = Promise.withResolvers<void>();
    const requests = fakeRequests(
      idleOperation,
      respond(RepositoryPullHttpApi.pull, async (command) => {
        pulled(command);
        await finished.promise;
        return { outcome: "FastForwarded" as const };
      }),
    );
    await render(
      <div style={{ height: 520, width: 900 }}>
        <RepositoryScopeProvider scope={repositoryScope({ repositoryId })}>
          <GraphWithPull reader={reader} />
        </RepositoryScopeProvider>
      </div>,
      { environment: { requests } },
    );
    await page.getByRole("button", { name: "Pull 3 incoming commits" }).click();
    await expect
      .element(page.getByRole("button", { name: "Fetch", exact: true }))
      .toBeDisabled();
    fetched.resolve(freshness);
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
  fetched = freshness,
  failure,
}: {
  readonly fetched?: RepositoryFreshness;
  readonly failure?: PullFailure;
} = {}) {
  const fetch = vi.fn(async () => fetched);
  const requested = vi.fn();
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryPullHttpApi.pull, async (command) => {
      requested(command);
      if (failure !== undefined) throw new EnvironmentHttpRejected({ failure });
      return { outcome: "FastForwarded" as const };
    }),
  );
  const reader = {
    fetch,
    getSnapshot: () => history,
    subscribe: () => () => {},
  };
  await render(
    <NotificationsProvider>
      <RepositoryScopeProvider scope={repositoryScope({ repositoryId })}>
        <Pull reader={reader} />
      </RepositoryScopeProvider>
    </NotificationsProvider>,
    { environment: { requests } },
  );
  return {
    fetch,
    requested,
    pull: () => page.getByRole("button", { name: "Pull" }).click(),
  };
}

function Pull({ reader }: { readonly reader: Parameters<typeof usePull>[0] }) {
  const pull = usePull(reader);
  return (
    <>
      <PullButton pull={pull} activeBranch="main" incoming={0} />
      <PullNotice pull={pull} />
    </>
  );
}

function GraphWithPull({
  reader,
}: {
  readonly reader: ReturnType<typeof historyReader>;
}) {
  const pull = usePull(reader);
  return (
    <CommitGraphFixture
      reader={reader}
      repositoryName="rebase-test"
      roots={[{ name: "main", oid: "0".repeat(40), type: "branch" }]}
      toolbarActions={
        <PullButton pull={pull} activeBranch="main" incoming={3} />
      }
    />
  );
}
