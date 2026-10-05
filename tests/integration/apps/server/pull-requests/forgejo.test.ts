import { describe, expect, it } from "vite-plus/test";
import { fakeForgejo } from "#tests-support/git-hosts/forgejo.ts";
import { pullRequestsFixture } from "#tests-support/git-hosts/pull-requests-fixture.ts";

describe("Forgejo and Gitea pull requests", () => {
  it("finds pull requests and checks on a server that tea is signed in to", async () => {
    const forgejo = fakeForgejo(
      {
        "remote-topic": [
          { number: 5, repository: "fork/rebase" },
          { number: 4, state: "merged" },
          { number: 6, draft: true, status: "failure" },
        ],
        other: [{ number: 3 }],
      },
      {
        logins: [
          { url: "https://codeberg.org", user: "forge" },
          {
            url: "https://git.example.com/forge",
            ssh_host: "ssh.example.com:2222",
            user: "forge",
          },
        ],
      },
    );
    const f = await pullRequestsFixture(
      { origin: "ssh://git@ssh.example.com:2222/team/Rebase.git" },
      { forgejo: forgejo.forgejo },
    );
    await f.track("topic", "origin", "remote-topic");

    await expect(f.list()).resolves.toEqual([
      {
        branch: "topic",
        pullRequests: [
          {
            kind: "PullRequest",
            number: 6,
            url: "https://git.example.com/forge/team/Rebase/pulls/6",
            title: "Pull request 6",
            state: "Draft",
            checks: "Failing",
          },
          {
            kind: "PullRequest",
            number: 4,
            url: "https://git.example.com/forge/team/Rebase/pulls/4",
            title: "Pull request 4",
            state: "Merged",
          },
        ],
      },
    ]);
    expect(forgejo.requests).toEqual([
      "login-1 /repos/team/Rebase/pulls?state=all&sort=recentupdate&limit=50&page=1",
      "login-1 /repos/team/Rebase/commits/6/status",
    ]);
  });

  it("asks nothing when tea has no login for the remote's server", async () => {
    const forgejo = fakeForgejo({});
    const f = await pullRequestsFixture(
      { origin: "https://codeberg.org:8443/team/rebase.git" },
      { forgejo: forgejo.forgejo },
    );
    await f.track("main", "origin", "main");

    await expect(f.list()).resolves.toEqual([]);
    expect(forgejo.requests).toEqual([]);
  });

  it("reports the server as unavailable when it answers with an error", async () => {
    const f = await pullRequestsFixture(
      { origin: "https://codeberg.org/forge/rebase.git" },
      { forgejo: fakeForgejo(null).forgejo },
    );
    await f.track("main", "origin", "main");

    await expect(f.list()).rejects.toEqual({
      _tag: "PullRequestsUnavailable",
    });
  });

  it("finds a pull request by number", async () => {
    const { forgejo } = fakeForgejo({
      elsewhere: [{ number: 12, state: "merged" }],
    });
    const f = await pullRequestsFixture(
      { origin: "https://codeberg.org/team/rebase.git" },
      { forgejo },
    );

    await expect(f.find(12)).resolves.toEqual({
      kind: "PullRequest",
      pullRequest: {
        kind: "PullRequest",
        number: 12,
        url: "https://codeberg.org/team/rebase/pulls/12",
        title: "Pull request 12",
        state: "Merged",
      },
    });
  });
});
