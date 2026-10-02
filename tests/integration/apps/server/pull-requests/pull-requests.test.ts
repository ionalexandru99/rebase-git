import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { PullRequestsApi } from "#contracts/pull-requests/pull-requests.contract.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { fakeAzureDevOps, fakeGitHub } from "#tests-support/git-hosts.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

describe("branch pull requests", () => {
  it("finds pull requests by each branch's upstream on the GitHub remote", async () => {
    const { github, requests } = fakeGitHub({
      "remote-topic": [
        { number: 7, state: "MERGED" },
        { number: 9, isDraft: true, checks: "PENDING" },
        { number: 8, owner: "fork" },
      ],
      main: [],
      mirrored: [{ number: 3 }],
    });
    const f = await fixture(
      { origin: "git@github.com:Octo/rebase.git", mirror: "/elsewhere.git" },
      { github },
    );
    await f.track("topic", "origin", "remote-topic");
    await f.track("main", "origin", "main");
    await f.track("mirrored", "mirror", "mirrored");

    await expect(f.list()).resolves.toEqual([
      {
        branch: "topic",
        pullRequests: [
          {
            number: 9,
            url: "https://github.com/Octo/rebase/pull/9",
            title: "Pull request 9",
            state: "Draft",
            checks: "Pending",
          },
          {
            number: 7,
            url: "https://github.com/Octo/rebase/pull/7",
            title: "Pull request 7",
            state: "Merged",
          },
        ],
      },
    ]);
    expect(requests).toEqual([
      { owner: "Octo", name: "rebase", b0: "main", b1: "remote-topic" },
    ]);
  });

  it("asks nothing when the repository is not on GitHub", async () => {
    const { github, requests } = fakeGitHub({});
    const f = await fixture({ origin: "/elsewhere.git" }, { github });
    await f.track("main", "origin", "main");

    await expect(f.list()).resolves.toEqual([]);
    expect(requests).toEqual([]);
  });

  it("reports GitHub as unavailable when the CLI fails", async () => {
    const f = await fixture(
      { origin: "https://github.com/octo/rebase" },
      { github: fakeGitHub(null).github },
    );
    await f.track("main", "origin", "main");

    await expect(f.list()).rejects.toEqual({
      _tag: "PullRequestsUnavailable",
    });
  });
});

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
    const f = await fixture(
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
          { number: 4, url: url(4), title: "Pull request 4", state: "Closed" },
        ],
      },
      {
        branch: "mirrored",
        pullRequests: [
          {
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
            number: 9,
            url: url(9),
            title: "Pull request 9",
            state: "Draft",
            checks: "Pending",
          },
          { number: 7, url: url(7), title: "Pull request 7", state: "Merged" },
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
    const f = await fixture({ origin }, { azureDevOps });
    await f.track("main", "origin", "main");

    await expect(f.list()).resolves.toEqual([
      {
        branch: "main",
        pullRequests: [
          {
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
    const f = await fixture(
      { origin: "git@ssh.dev.azure.com:v3/acme/rebase/rebase" },
      { azureDevOps: fakeAzureDevOps(null).azureDevOps },
    );
    await f.track("main", "origin", "main");

    await expect(f.list()).rejects.toEqual({
      _tag: "PullRequestsUnavailable",
    });
  });
});

async function fixture(
  remotes: Readonly<Record<string, string>>,
  clients: Parameters<typeof openTestEnvironment>[0],
) {
  const environment = await openTestEnvironment(clients);
  const repositoryPath = join(environment.home, "repository");
  await createRepository(repositoryPath, {
    branches: ["topic", "mirrored", "elsewhere"],
  });
  for (const [remote, url] of Object.entries(remotes))
    await git(repositoryPath, "remote", "add", remote, url);
  const repositoryId = (await environment.remember(repositoryPath)).id;
  const service = environment.routes(PullRequestsApi);
  return {
    list: () => Effect.runPromise(service.list({ repositoryId })),
    track: async (branch: string, remote: string, head: string) => {
      await git(repositoryPath, "config", `branch.${branch}.remote`, remote);
      await git(
        repositoryPath,
        "config",
        `branch.${branch}.merge`,
        `refs/heads/${head}`,
      );
    },
  };
}
