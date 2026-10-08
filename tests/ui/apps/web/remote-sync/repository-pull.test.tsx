import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import {
  type BranchPulled,
  type PullFailure,
  type RepositoryFetchStatus,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { RepositoryStashesApi } from "#contracts/repository-stashes/repository-stashes.contract.ts";
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
  conflictedRebase,
  fetchStatus,
  repositoryId,
  repositoryRefs,
  repositoryScope,
  upstream,
  worktree,
} from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation.ts";
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
        return pulledCleanly;
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
    await expectFetchItemDisabled();
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
    await expectFetchItemDisabled();
    finished.resolve();
    await expect
      .element(page.getByRole("button", { name: "Pull 3 incoming commits" }))
      .toBeEnabled();
  });

  it("shows the fetch and then the pull progress in one toast that turns into the result", async () => {
    const fetched = Promise.withResolvers<RepositoryFetchStatus>();
    const pulled = Promise.withResolvers<typeof pulledCleanly>();
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
    pulled.resolve(pulledCleanly);

    await expect
      .element(page.getByText("Pulled", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByRole("progressbar")).not.toBeInTheDocument();
  });

  it("asks how to pull a diverged branch and pulls again with the choice from the menu", async () => {
    const upstreamCommit = "b".repeat(40);
    const requested = vi.fn();
    const merged = Promise.withResolvers<BranchPulled>();
    const requests = fakeRequests(
      idleOperation,
      respond(RepositoryRefsApi.read, async () => refs(1)),
      respond(RepositoryPullApi.fetchStatus, async () => status),
      respond(RepositoryPullApi.fetch, async () => status),
      respond(RepositoryPullApi.pull, async (command) => {
        requested(command);
        if (command.strategy === undefined)
          throw rejected({
            _tag: "PullDiverged" as const,
            upstream: "origin/main",
            upstreamCommit,
          });
        return merged.promise;
      }),
    );
    await render(
      <RepositoryScopeProvider scope={repositoryScope({ repositoryId })}>
        <RemoteSync>{(actions) => actions}</RemoteSync>
      </RepositoryScopeProvider>,
      { environment: { requests } },
    );

    await page.getByRole("button", { name: "Pull 1 incoming commit" }).click();
    await expect.element(page.getByText("Branch has diverged")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Rebase" }))
      .toBeVisible();
    await page.getByRole("button", { name: "More choices" }).click();
    await page.getByRole("menuitem", { name: "Merge" }).click();

    await expect
      .poll(() => requested)
      .toHaveBeenLastCalledWith({
        repositoryId,
        worktreePath: "/repo",
        branch: "main",
        strategy: { kind: "merge", upstream: upstreamCommit },
      });
    await expect
      .element(page.getByRole("progressbar", { name: "Merging" }))
      .toBeVisible();
    merged.resolve({ outcome: "Merged", stashKept: false });
    await expect.element(page.getByText("Pulled and merged")).toBeVisible();
    await expect
      .element(page.getByText("Branch has diverged"))
      .not.toBeInTheDocument();
  });

  it("says a copy of local changes is in Stashes when they conflict with the pull", async () => {
    await fixture({ pulled: { outcome: "FastForwarded", stashKept: true } });
    await page.getByRole("button", { name: "Pull" }).click();
    await expect
      .element(page.getByText("Pulled, but your changes conflict"))
      .toBeVisible();
    await expect
      .element(page.getByText("A copy is saved in Stashes."))
      .toBeVisible();
  });

  it("says the local changes are in Stashes when the pull failed after stashing them and pops them back", async () => {
    const stash = "a".repeat(40);
    const f = await fixture({
      failure: { _tag: "PullStashKept", stash, busy: true },
    });
    await f.pull();
    await expect.element(page.getByText("Couldn't pull")).toBeVisible();
    await expect
      .element(
        page.getByText(
          "Another Git operation is running. Your changes are in Stashes.",
        ),
      )
      .toBeVisible();

    await page.getByRole("button", { name: "Apply" }).click();

    await expect
      .poll(() => f.applied)
      .toHaveBeenCalledWith({
        repositoryId,
        worktreePath: "/repo",
        oid: stash,
        restoreIndex: true,
        drop: true,
      });
    await expect.element(page.getByText("Your changes are back")).toBeVisible();
  });

  it("says the local changes are in Stashes when the pull landed without them", async () => {
    await fixture({
      pulled: {
        outcome: "FastForwarded",
        stashKept: false,
        movedToStash: "a".repeat(40),
      },
    });
    await page.getByRole("button", { name: "Pull" }).click();
    await expect
      .element(page.getByText("Pulled", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText("Your changes are in Stashes."))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Apply" }))
      .toBeVisible();
  });

  it("hands a pull that stopped on conflicts over to the operation and closes its toast", async () => {
    const f = await fixture({
      pulled: {
        outcome: "Stopped",
        worktreePath: "/repo",
        operation: conflictedRebase(),
      },
    });
    await f.pull();
    await expect.element(page.getByText("Operation conflicts")).toBeVisible();
    await expect.element(page.getByText("Pulling")).not.toBeInTheDocument();
    await expect.element(page.getByRole("progressbar")).not.toBeInTheDocument();
  });

  it("points to the other worktree when the pull stopped on conflicts there", async () => {
    const f = await fixture({
      pulled: {
        outcome: "Stopped",
        worktreePath: "/linked",
        operation: conflictedRebase(),
      },
    });
    await f.pull();
    await expect.element(page.getByText("Couldn't pull")).toBeVisible();
    await expect
      .element(page.getByText("Resolve the conflicts in the other worktree."))
      .toBeVisible();
  });

  it.each<[PullFailure, string]>([
    [
      { _tag: "PullWouldOverwrite", paths: ["src/app.ts"] },
      "Untracked app.ts is in the way.",
    ],
    [
      { _tag: "PullWouldOverwrite", paths: ["src/app.ts", "README.md"] },
      "Untracked files are in the way.",
    ],
    [{ _tag: "UpstreamMissing" }, "No upstream branch."],
    [
      { _tag: "UpstreamMissing", upstream: "origin/main" },
      "The remote branch was deleted.",
    ],
    [{ _tag: "UpstreamMoved" }, "The remote branch moved."],
    [{ _tag: "BranchMissing" }, "The branch no longer exists."],
  ])("explains a rejected pull: %j", async (failure, message) => {
    const f = await fixture({ failure });
    await f.pull();
    await expect.element(page.getByText(message)).toBeVisible();
  });
});

const pulledCleanly = {
  outcome: "FastForwarded" as const,
  stashKept: false,
};

async function fixture({
  fetchFails = false,
  failure,
  pulled = pulledCleanly,
}: {
  readonly fetchFails?: boolean;
  readonly failure?: PullFailure;
  readonly pulled?: BranchPulled;
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
  const applied = vi.fn();
  const requests = fakeRequests(
    idleOperation,
    respond(RepositoryRefsApi.read, async () => refs(0)),
    respond(RepositoryPullApi.fetchStatus, async () => status),
    respond(RepositoryPullApi.fetch, fetch),
    respond(RepositoryPullApi.pull, async (command) => {
      requested(command);
      if (failure !== undefined) throw rejected(failure);
      return pulled;
    }),
    respond(RepositoryStashesApi.apply, async (command) => {
      applied(command);
      return { conflicts: 0 };
    }),
  );
  await render(
    <RepositoryScopeProvider scope={repositoryScope({ repositoryId })}>
      <RemoteSync>{(actions) => actions}</RemoteSync>
      <OperationProbe />
    </RepositoryScopeProvider>,
    { environment: { requests } },
  );
  return {
    fetch,
    requested,
    applied,
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

function OperationProbe() {
  const operation = useOperation(
    { repositoryId, worktreePath: "/repo" },
    false,
  );
  return <p>Operation {operation.data?.phase}</p>;
}

async function expectFetchItemDisabled() {
  await page.getByRole("button", { name: "More sync actions" }).click();
  await expect
    .element(page.getByRole("menuitem", { name: "Fetch" }))
    .toHaveAttribute("aria-disabled", "true");
  await userEvent.keyboard("{Escape}");
}
