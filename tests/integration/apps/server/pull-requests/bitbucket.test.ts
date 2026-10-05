import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { fakeBitbucket } from "#tests-support/git-hosts/bitbucket.ts";
import { pullRequestsFixture } from "#tests-support/git-hosts/pull-requests-fixture.ts";

describe("Bitbucket pull requests", () => {
  it("finds pull requests and build checks on the Bitbucket repository with the saved token", async () => {
    const { bitbucket, requests } = fakeBitbucket({
      "remote-topic": [
        { id: 7, state: "MERGED" },
        { id: 9, draft: true, checks: ["SUCCESSFUL", "INPROGRESS"] },
        { id: 8, fork: true },
      ],
      main: [{ id: 3, checks: ["FAILED"] }],
    });
    const f = await pullRequestsFixture(
      {
        origin: "git@bitbucket.org:Acme/rebase.git",
        other: "https://octo@bitbucket.org/acme/other.git",
      },
      { bitbucket },
    );
    await f.track("topic", "origin", "remote-topic");
    await f.track("main", "origin", "main");
    await f.track("elsewhere", "other", "elsewhere");
    await Effect.runPromise(
      f.sourceControl.saveBitbucketToken({
        _tag: "AccessToken",
        token: "access-token",
      }),
    );

    const url = (id: number) =>
      `https://bitbucket.org/Acme/rebase/pull-requests/${id}`;
    await expect(f.list()).resolves.toEqual([
      {
        branch: "main",
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
    expect(new Set(requests.map(({ authorization }) => authorization))).toEqual(
      new Set(["Bearer access-token"]),
    );
    expect(requests.filter(({ url }) => url.includes("acme/other"))).toEqual(
      [],
    );
  });

  it("asks Bitbucket nothing until a token is saved", async () => {
    const { bitbucket, requests } = fakeBitbucket({ main: [{ id: 1 }] });
    const f = await pullRequestsFixture(
      { origin: "https://bitbucket.org/acme/rebase.git" },
      { bitbucket },
    );
    await f.track("main", "origin", "main");

    await expect(f.list()).resolves.toEqual([]);
    expect(requests).toEqual([]);
  });
});
