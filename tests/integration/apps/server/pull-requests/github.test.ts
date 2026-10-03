import { describe, expect, it } from "vite-plus/test";
import { fakeGitHub } from "#tests-support/git-hosts/github.ts";
import { pullRequestsFixture } from "#tests-support/git-hosts/pull-requests-fixture.ts";

describe("GitHub pull requests", () => {
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
    const f = await pullRequestsFixture(
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
            kind: "PullRequest",
            number: 9,
            url: "https://github.com/Octo/rebase/pull/9",
            title: "Pull request 9",
            state: "Draft",
            checks: "Pending",
          },
          {
            kind: "PullRequest",
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
    const f = await pullRequestsFixture(
      { origin: "/elsewhere.git" },
      { github },
    );
    await f.track("main", "origin", "main");

    await expect(f.list()).resolves.toEqual([]);
    expect(requests).toEqual([]);
  });

  it("reports GitHub as unavailable when the CLI fails", async () => {
    const f = await pullRequestsFixture(
      { origin: "https://github.com/octo/rebase" },
      { github: fakeGitHub(null).github },
    );
    await f.track("main", "origin", "main");

    await expect(f.list()).rejects.toEqual({
      _tag: "PullRequestsUnavailable",
    });
  });
});
