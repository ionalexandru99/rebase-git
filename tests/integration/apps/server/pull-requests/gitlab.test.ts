import { describe, expect, it } from "vite-plus/test";
import { fakeGitLab } from "#tests-support/git-hosts/gitlab.ts";
import { pullRequestsFixture } from "#tests-support/git-hosts/pull-requests-fixture.ts";

describe("GitLab merge requests", () => {
  it("finds merge requests on a GitLab server that glab is signed in to", async () => {
    const gitlab = fakeGitLab(
      {
        "remote-topic": [
          { iid: 5, project: "fork/rebase" },
          { iid: 4, state: "merged" },
          { iid: 6, draft: true, pipeline: "RUNNING" },
        ],
      },
      { accounts: { "git.example.com": "tanuki" } },
    );
    const f = await pullRequestsFixture(
      { origin: "git@git.example.com:group/sub/rebase.git" },
      { gitlab: gitlab.gitlab },
    );
    await f.track("topic", "origin", "remote-topic");

    await expect(f.list()).resolves.toEqual([
      {
        branch: "topic",
        pullRequests: [
          {
            kind: "MergeRequest",
            number: 6,
            url: "https://git.example.com/group/sub/rebase/-/merge_requests/6",
            title: "Merge request 6",
            state: "Draft",
            checks: "Pending",
          },
          {
            kind: "MergeRequest",
            number: 4,
            url: "https://git.example.com/group/sub/rebase/-/merge_requests/4",
            title: "Merge request 4",
            state: "Merged",
          },
        ],
      },
    ]);
    expect(gitlab.requests).toEqual([
      {
        hostname: "git.example.com",
        fullPath: "group/sub/rebase",
        b0: "remote-topic",
      },
    ]);
  });

  it("asks nothing when glab is not signed in to the remote's server", async () => {
    const gitlab = fakeGitLab({}, { accounts: {} });
    const f = await pullRequestsFixture(
      { origin: "https://gitlab.com/group/rebase.git" },
      { gitlab: gitlab.gitlab },
    );
    await f.track("main", "origin", "main");

    await expect(f.list()).resolves.toEqual([]);
    expect(gitlab.requests).toEqual([]);
  });

  it("finds a merge request by number", async () => {
    const { gitlab } = fakeGitLab({
      elsewhere: [{ iid: 12, state: "merged" }],
    });
    const f = await pullRequestsFixture(
      { origin: "git@gitlab.com:group/rebase.git" },
      { gitlab },
    );

    await expect(f.find(12)).resolves.toEqual({
      kind: "MergeRequest",
      pullRequest: {
        kind: "MergeRequest",
        number: 12,
        url: "https://gitlab.com/group/rebase/-/merge_requests/12",
        title: "Merge request 12",
        state: "Merged",
      },
    });
    await expect(f.find(13)).resolves.toEqual({
      kind: "MergeRequest",
      pullRequest: null,
    });
  });
});
