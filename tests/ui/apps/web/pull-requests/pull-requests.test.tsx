import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type { RouteSuccess } from "#contracts/environment-connection/environment-route.contract.ts";
import { PullRequestsApi } from "#contracts/pull-requests/pull-requests.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  fakeRequests,
  idleOperation,
  respond,
} from "#tests-support/fake-requests.ts";
import {
  mainAndTopicWorktrees,
  mainPath,
  pullRequest,
  repositoryId,
  repositoryRefs,
  repositoryScope,
  topicPath,
} from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar.tsx";
import {
  CurrentPullRequest,
  usePullRequests,
} from "#web/features/pull-requests/pull-requests.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

describe("branch pull requests", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows each branch's pull request and opens the current one from the header", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const screen = await renderPullRequests();

    await expect
      .element(
        screen.getByRole("treeitem", {
          name: "feature, pull request #9, open, checks failing",
        }),
      )
      .toBeVisible();
    await screen
      .getByRole("button", {
        name: "Open pull request #7, open, checks passing",
      })
      .click();

    expect(opened).toHaveBeenCalledWith(
      "https://github.com/octo/rebase/pull/7",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("lists every pull request of a branch in its menu", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const screen = await renderPullRequests();

    await screen
      .getByRole("treeitem", {
        name: /^topic, linked worktree, pull request #12, draft/,
      })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Pull requests" }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: /^Pull request 12/ }))
      .toBeVisible();
    await userEvent.click(
      screen.getByRole("menuitem", { name: /^Pull request 11/ }),
    );

    expect(opened).toHaveBeenCalledWith(
      "https://github.com/octo/rebase/pull/11",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("names GitLab merge requests the GitLab way", async () => {
    const screen = await renderPullRequests([
      {
        branch: "feature",
        pullRequests: [pullRequest(4, { kind: "MergeRequest" })],
      },
    ]);

    await screen
      .getByRole("treeitem", { name: "feature, merge request !4, open" })
      .click({ button: "right" });

    await expect
      .element(screen.getByRole("menuitem", { name: "Open merge request" }))
      .toBeVisible();
  });
});

function PullRequestsHarness() {
  const pullRequests = usePullRequests();
  return (
    <>
      <CurrentPullRequest pullRequests={pullRequests} />
      <div style={{ height: 480, width: 320 }}>
        <BranchesSidebar pullRequests={pullRequests} />
      </div>
    </>
  );
}

function renderPullRequests(
  branches: RouteSuccess<typeof PullRequestsApi.list> = [
    {
      branch: "main",
      pullRequests: [pullRequest(7, { checks: "Passing" })],
    },
    {
      branch: "feature",
      pullRequests: [pullRequest(9, { checks: "Failing" })],
    },
    {
      branch: "topic",
      pullRequests: [
        pullRequest(12, { state: "Draft" }),
        pullRequest(11, { state: "Merged" }),
      ],
    },
  ],
) {
  return render(
    <RepositoryScopeProvider
      scope={repositoryScope({ repositoryId, worktreePath: mainPath })}
    >
      <PullRequestsHarness />
    </RepositoryScopeProvider>,
    {
      environment: {
        requests: fakeRequests(
          idleOperation,
          respond(RepositoryRefsApi.read, async () =>
            repositoryRefs({
              branches: [
                { name: "main", worktreePath: mainPath },
                { name: "feature" },
                { name: "topic", worktreePath: topicPath },
              ],
              worktrees: mainAndTopicWorktrees(),
            }),
          ),
          respond(PullRequestsApi.list, async () => branches),
        ),
      },
    },
  );
}
