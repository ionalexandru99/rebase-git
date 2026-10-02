import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { PullRequestsApi } from "#contracts/pull-requests/pull-requests.contract.ts";
import { createRepository, git } from "#tests-support/git.ts";
import {
  fakeGitHub,
  type GitHubPullRequestNode,
  openTestEnvironment,
} from "#tests-support/server.ts";

describe("branch pull requests", () => {
  it("finds pull requests by each branch's upstream on the GitHub remote", async () => {
    const f = await fixture(
      {
        "remote-topic": [
          { number: 7, state: "MERGED" },
          { number: 9, isDraft: true, checks: "PENDING" },
          { number: 8, owner: "fork" },
        ],
        main: [],
        mirrored: [{ number: 3 }],
      },
      { origin: "git@github.com:Octo/rebase.git", mirror: "/elsewhere.git" },
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
    expect(f.requests).toEqual([
      { owner: "Octo", name: "rebase", b0: "main", b1: "remote-topic" },
    ]);
  });

  it("asks nothing when the repository is not on GitHub", async () => {
    const f = await fixture({}, { origin: "/elsewhere.git" });
    await f.track("main", "origin", "main");

    await expect(f.list()).resolves.toEqual([]);
    expect(f.requests).toEqual([]);
  });

  it("reports GitHub as unavailable when the CLI fails", async () => {
    const f = await fixture(null, { origin: "https://github.com/octo/rebase" });
    await f.track("main", "origin", "main");

    await expect(f.list()).rejects.toEqual({
      _tag: "PullRequestsUnavailable",
    });
  });
});

async function fixture(
  byHead: Readonly<Record<string, readonly GitHubPullRequestNode[]>> | null,
  remotes: Readonly<Record<string, string>>,
) {
  const { github, requests } = fakeGitHub(byHead);
  const environment = await openTestEnvironment({ github });
  const repositoryPath = join(environment.home, "repository");
  await createRepository(repositoryPath, { branches: ["topic", "mirrored"] });
  for (const [remote, url] of Object.entries(remotes))
    await git(repositoryPath, "remote", "add", remote, url);
  const repositoryId = (await environment.remember(repositoryPath)).id;
  const service = environment.routes(PullRequestsApi);
  return {
    requests,
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
