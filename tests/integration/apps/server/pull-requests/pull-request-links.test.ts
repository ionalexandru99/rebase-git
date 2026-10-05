import { describe, expect, it } from "vite-plus/test";
import { git } from "#tests-support/git.ts";
import { fakeGitHub } from "#tests-support/git-hosts/github.ts";
import { pullRequestsFixture } from "#tests-support/git-hosts/pull-requests-fixture.ts";

const origin = "https://github.com/octo/rebase.git";

function linked(number: number, state = "Open") {
  return {
    kind: "PullRequest",
    number,
    url: `https://github.com/octo/rebase/pull/${number}`,
    title: `Pull request ${number}`,
    state,
  };
}

describe("Pull request links", () => {
  it("leaves the remote default branch without matched pull requests but shows the ones linked to it", async () => {
    const { github, requests } = fakeGitHub({
      main: [{ number: 2, state: "MERGED" }],
      release: [{ number: 5 }],
    });
    const f = await pullRequestsFixture({ origin }, { github });
    await f.track("main", "origin", "main");
    await git(
      f.repositoryPath,
      "update-ref",
      "refs/remotes/origin/main",
      "HEAD",
    );
    await git(
      f.repositoryPath,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    );

    await expect(f.list()).resolves.toEqual([]);
    expect(requests).toEqual([]);

    await f.link("main", 5);

    await expect(f.list()).resolves.toEqual([
      { branch: "main", pullRequests: [linked(5)] },
    ]);
  });

  it("hides an unlinked pull request and shows one linked from another branch", async () => {
    const { github } = fakeGitHub({
      "remote-topic": [{ number: 7 }],
      renamed: [{ number: 9, state: "MERGED" }],
    });
    const f = await pullRequestsFixture({ origin }, { github });
    await f.track("topic", "origin", "remote-topic");

    await f.link("topic", 7, false);
    await f.link("elsewhere", 9);

    await expect(f.list()).resolves.toEqual([
      { branch: "elsewhere", pullRequests: [linked(9, "Merged")] },
    ]);

    await f.link("topic", 7);
    await f.link("elsewhere", 9, false);

    await expect(f.list()).resolves.toEqual([
      { branch: "topic", pullRequests: [linked(7)] },
    ]);
  });

  it("finds a pull request by number to link", async () => {
    const { github } = fakeGitHub({ renamed: [{ number: 9 }] });
    const f = await pullRequestsFixture({ origin }, { github });

    await expect(f.find(9)).resolves.toEqual({
      kind: "PullRequest",
      pullRequest: linked(9),
    });
    await expect(f.find(10)).resolves.toEqual({
      kind: "PullRequest",
      pullRequest: null,
    });
  });
});
