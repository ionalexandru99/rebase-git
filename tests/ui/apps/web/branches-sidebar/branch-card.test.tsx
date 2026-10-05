import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  type LinkPullRequest,
  PullRequestsApi,
} from "#contracts/pull-requests/pull-requests.contract.ts";
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
  upstream,
} from "#tests-support/fixtures.ts";
import {
  fakeRepositoryHistory,
  historyCommit,
  historyOid,
} from "#tests-support/history.ts";
import { render } from "#tests-support/render.tsx";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar.tsx";
import { usePullRequests } from "#web/features/pull-requests/pull-requests.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

describe("branch card", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the full name, worktree and every pull request of a hovered branch", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const screen = await renderCard();

    await screen.getByRole("treeitem", { name: "feature" }).click();
    await userEvent.hover(
      screen.getByRole("treeitem", {
        name: /^feature\/topic, linked worktree/,
      }),
    );
    const card = screen.getByRole("group", { name: "feature/topic" });
    const older = card.getByRole("button", {
      name: "Open pull request #11, merged",
    });
    await expect.element(older).toBeVisible();
    await expect
      .element(card.getByText("feature/topic", { exact: true }))
      .toBeVisible();
    await expect.element(card.getByText("Worktree topic")).toBeVisible();
    await expect
      .element(card.getByText("Pull request 12", { exact: true }))
      .toBeVisible();
    await older.click();

    expect(opened).toHaveBeenCalledWith(
      "https://github.com/octo/rebase/pull/11",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("unlinks a pull request from the card at once", async () => {
    const links: LinkPullRequest[] = [];
    const screen = await renderCard(links);

    await screen.getByRole("treeitem", { name: "feature" }).click();
    await userEvent.hover(
      screen.getByRole("treeitem", {
        name: /^feature\/topic, linked worktree/,
      }),
    );
    const card = screen.getByRole("group", { name: "feature/topic" });
    const unlink = card.getByRole("button", {
      name: "Unlink pull request #11",
    });
    await userEvent.hover(unlink);
    await unlink.click();

    await expect
      .element(card.getByText("Pull request 11", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(card.getByText("Pull request 12", { exact: true }))
      .toBeVisible();
    expect(links).toEqual([
      expect.objectContaining({
        branch: "feature/topic",
        number: 11,
        linked: false,
      }),
    ]);
  });

  it("links a pull request by number from the branch menu in a pinned card", async () => {
    const links: LinkPullRequest[] = [];
    const screen = await renderCard(links);

    await screen
      .getByRole("treeitem", { name: "draft" })
      .click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Link pull request…" }).click();
    const field = screen.getByRole("textbox", {
      name: "Pull request number or link",
    });
    await expect.element(field).toHaveFocus();
    await userEvent.keyboard("99");
    await expect.element(screen.getByText("No pull request #99")).toBeVisible();
    await userEvent.hover(screen.getByRole("treeitem", { name: "shared" }));
    await expect
      .element(screen.getByRole("group", { name: "draft" }))
      .toBeVisible();
    await field.fill("#21");
    await expect
      .element(screen.getByText("Pull request 21", { exact: true }))
      .toBeVisible();
    await userEvent.keyboard("{Enter}");

    await expect
      .element(screen.getByRole("group", { name: "draft" }))
      .not.toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("treeitem", { name: /^draft, pull request #21/ }),
      )
      .toBeVisible();
    expect(links).toEqual([
      expect.objectContaining({ branch: "draft", number: 21, linked: true }),
    ]);
  });

  it("shows the last commit of a branch and when it settled", async () => {
    const screen = await renderCard();

    await screen.getByRole("treeitem", { name: /^Settled/ }).click();
    await userEvent.hover(
      screen.getByRole("treeitem", { name: /^main, current branch/ }),
    );
    const main = screen.getByRole("group", { name: "main" });
    await expect.element(main.getByText("Ship the branch card")).toBeVisible();
    await expect.element(main.getByText(/^Alex I\. · /)).toBeVisible();
    await userEvent.hover(screen.getByRole("treeitem", { name: /^done/ }));
    await expect
      .element(
        screen
          .getByRole("group", { name: "done" })
          .getByText("Settled 2 days ago"),
      )
      .toBeVisible();
  });

  it("says when a branch was never pushed or its remote branch was deleted", async () => {
    const screen = await renderCard();

    await userEvent.hover(screen.getByRole("treeitem", { name: "draft" }));
    await expect.element(screen.getByText("Never pushed")).toBeVisible();
    await userEvent.hover(screen.getByRole("treeitem", { name: "shared" }));
    await expect
      .element(screen.getByRole("group", { name: "shared" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Never pushed"))
      .not.toBeInTheDocument();
    await userEvent.hover(
      screen.getByRole("treeitem", { name: "old, remote branch deleted" }),
    );
    await expect
      .element(screen.getByText("Remote branch deleted"))
      .toBeVisible();
    await expect
      .element(screen.getByText("Never pushed"))
      .not.toBeInTheDocument();
  });
});

const mainTip = historyOid(1);
const history = fakeRepositoryHistory({
  commits: [
    historyCommit(mainTip, [], Date.now() / 1_000, "Ship the branch card"),
  ],
});

function daysAgo(days: number) {
  const today = new Date();
  const date = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - days,
  );
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

function CardHarness() {
  const pullRequests = usePullRequests();
  return (
    <div style={{ height: 480, width: 320 }}>
      <BranchesSidebar history={history} pullRequests={pullRequests} />
    </div>
  );
}

function renderCard(links: LinkPullRequest[] = []) {
  return render(
    <RepositoryScopeProvider
      scope={repositoryScope({ repositoryId, worktreePath: mainPath })}
    >
      <CardHarness />
    </RepositoryScopeProvider>,
    {
      environment: {
        requests: fakeRequests(
          idleOperation,
          respond(RepositoryRefsApi.read, async () =>
            repositoryRefs({
              branches: [
                {
                  name: "main",
                  target: mainTip,
                  upstream: upstream("origin/main"),
                  worktreePath: mainPath,
                },
                { name: "draft" },
                {
                  name: "done",
                  settled: daysAgo(2),
                  upstream: upstream("origin/done"),
                },
                { name: "shared" },
                {
                  name: "old",
                  upstream: upstream("origin/old", { gone: true }),
                },
                {
                  name: "feature/topic",
                  upstream: upstream("origin/feature/topic"),
                  worktreePath: topicPath,
                },
              ],
              remoteBranches: [{ name: "shared", remote: "upstream" }],
              worktrees: mainAndTopicWorktrees(),
            }),
          ),
          respond(PullRequestsApi.find, async ({ number }) => ({
            kind: "PullRequest" as const,
            pullRequest: number === 21 ? pullRequest(21) : null,
          })),
          respond(PullRequestsApi.link, async (input) => {
            links.push(input);
            return {};
          }),
          respond(PullRequestsApi.list, async () => [
            {
              branch: "feature/topic",
              pullRequests: [
                pullRequest(12),
                pullRequest(11, { state: "Merged" }),
              ],
            },
          ]),
        ),
      },
    },
  );
}
