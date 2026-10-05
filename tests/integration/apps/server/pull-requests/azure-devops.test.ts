import { describe, expect, it } from "vite-plus/test";
import { fakeAzureDevOps } from "#tests-support/git-hosts/azure-devops.ts";
import { pullRequestsFixture } from "#tests-support/git-hosts/pull-requests-fixture.ts";

describe("Azure DevOps pull requests", () => {
  it("finds pull requests and build checks by each branch's upstream on the Azure DevOps repository", async () => {
    const { azureDevOps, requests } = fakeAzureDevOps({
      "remote-topic": [
        { id: 7, status: "completed" },
        { id: 9, isDraft: true, checks: ["approved", "running"] },
        { id: 8, fork: true },
      ],
      main: [{ id: 4, status: "abandoned" }],
      mirrored: [{ id: 3, checks: ["rejected"] }],
    });
    const f = await pullRequestsFixture(
      {
        origin: "https://acme@dev.azure.com/acme/Rebase%20App/_git/rebase",
        mirror: "git@ssh.dev.azure.com:v3/acme/Rebase%20App/rebase",
        other: "https://acme.visualstudio.com/Other/_git/other",
      },
      { azureDevOps },
    );
    await f.track("topic", "origin", "remote-topic");
    await f.track("main", "origin", "main");
    await f.track("mirrored", "mirror", "mirrored");
    await f.track("elsewhere", "other", "elsewhere");

    const pullRequests = await f.list();

    const url = (id: number) =>
      `https://dev.azure.com/acme/Rebase%20App/_git/rebase/pullrequest/${id}`;
    expect(pullRequests).toEqual([
      {
        branch: "main",
        pullRequests: [
          {
            kind: "PullRequest",
            number: 4,
            url: url(4),
            title: "Pull request 4",
            state: "Closed",
          },
        ],
      },
      {
        branch: "mirrored",
        pullRequests: [
          {
            kind: "PullRequest",
            number: 3,
            url: url(3),
            title: "Pull request 3",
            state: "Open",
            checks: "Failing",
          },
        ],
      },
      {
        branch: "topic",
        pullRequests: [
          {
            kind: "PullRequest",
            number: 9,
            url: url(9),
            title: "Pull request 9",
            state: "Draft",
            checks: "Pending",
          },
          {
            kind: "PullRequest",
            number: 7,
            url: url(7),
            title: "Pull request 7",
            state: "Merged",
          },
        ],
      },
    ]);
    expect(
      requests
        .map((request) => {
          const { searchParams } = new URL(request);
          return (
            searchParams.get("searchCriteria.sourceRefName") ??
            searchParams.get("artifactId")
          );
        })
        .sort(),
    ).toEqual([
      "refs/heads/main",
      "refs/heads/mirrored",
      "refs/heads/remote-topic",
      "vstfs:///CodeReview/CodeReviewId/project-id/3",
      "vstfs:///CodeReview/CodeReviewId/project-id/9",
    ]);
  });

  it.each([
    "https://acme.visualstudio.com/DefaultCollection/Rebase/_git/Rebase",
    "acme@vs-ssh.visualstudio.com:v3/acme/Rebase/Rebase",
    "https://dev.azure.com/acme/_git/Rebase",
  ])("reads the %s remote form", async (origin) => {
    const { azureDevOps } = fakeAzureDevOps({ main: [{ id: 1, checks: [] }] });
    const f = await pullRequestsFixture({ origin }, { azureDevOps });
    await f.track("main", "origin", "main");

    await expect(f.list()).resolves.toEqual([
      {
        branch: "main",
        pullRequests: [
          {
            kind: "PullRequest",
            number: 1,
            url: "https://dev.azure.com/acme/Rebase/_git/Rebase/pullrequest/1",
            title: "Pull request 1",
            state: "Open",
          },
        ],
      },
    ]);
  });

  it("reports Azure DevOps as unavailable when the CLI cannot sign in", async () => {
    const f = await pullRequestsFixture(
      { origin: "git@ssh.dev.azure.com:v3/acme/rebase/rebase" },
      { azureDevOps: fakeAzureDevOps(null).azureDevOps },
    );
    await f.track("main", "origin", "main");

    await expect(f.list()).rejects.toEqual({
      _tag: "PullRequestsUnavailable",
    });
  });

  it("finds a pull request by number", async () => {
    const { azureDevOps } = fakeAzureDevOps({
      elsewhere: [{ id: 12, checks: ["approved"] }],
    });
    const f = await pullRequestsFixture(
      { origin: "https://dev.azure.com/acme/App/_git/rebase" },
      { azureDevOps },
    );

    await expect(f.find(12)).resolves.toEqual({
      kind: "PullRequest",
      pullRequest: {
        kind: "PullRequest",
        number: 12,
        url: "https://dev.azure.com/acme/App/_git/rebase/pullrequest/12",
        title: "Pull request 12",
        state: "Open",
        checks: "Passing",
      },
    });
  });
});
