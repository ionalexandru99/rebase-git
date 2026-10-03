import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { GitHost } from "#server/features/source-control/git-host.ts";
import { createForgejoHost } from "#server/features/source-control/hosts/forgejo-host.ts";
import { createGitHubHost } from "#server/features/source-control/hosts/github-host.ts";
import { createGitLabHost } from "#server/features/source-control/hosts/gitlab-host.ts";
import { fakeForgejo } from "#tests-support/git-hosts/forgejo.ts";
import { fakeGitHub } from "#tests-support/git-hosts/github.ts";
import { fakeGitLab } from "#tests-support/git-hosts/gitlab.ts";

describe("host pull request answers", () => {
  it("leaves out a GitHub branch whose full page held only other owners' pull requests", async () => {
    const forks = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        number: index + 1,
        owner: "fork",
      }));
    const { github } = fakeGitHub({
      crowded: forks(10),
      mixed: [...forks(9), { number: 20, state: "MERGED" as const }],
      quiet: forks(2),
    });

    const answers = await pullRequests(
      createGitHubHost(github),
      "git@github.com:Octo/rebase.git",
      ["crowded", "mixed", "quiet"],
    );

    expect(answers).toEqual({
      mixed: [expect.objectContaining({ number: 20, state: "Merged" })],
      quiet: [],
    });
  });

  it("reports GitLab as unavailable when the account cannot see the project", async () => {
    const { gitlab } = fakeGitLab({}, { visible: false });

    await expect(
      pullRequests(
        createGitLabHost(gitlab),
        "git@gitlab.com:group/rebase.git",
        ["topic"],
      ),
    ).rejects.toEqual({ _tag: "PullRequestsUnavailable" });
  });

  it("answers Forgejo branches without pull requests only when it read every page", async () => {
    const busy = Array.from({ length: 200 }, (_, index) => ({
      number: index + 1,
      state: "closed" as const,
    }));
    const read = (byHead: Parameters<typeof fakeForgejo>[0]) =>
      pullRequests(
        createForgejoHost(fakeForgejo(byHead).forgejo),
        "https://codeberg.org/forge/rebase.git",
        ["busy", "quiet"],
      );

    await expect(read({ busy })).resolves.toEqual({
      busy: expect.arrayContaining([expect.objectContaining({ number: 1 })]),
    });
    await expect(read({ busy: busy.slice(0, 3) })).resolves.toMatchObject({
      quiet: [],
    });
  });
});

async function pullRequests(
  host: GitHost,
  remoteUrl: string,
  heads: readonly string[],
) {
  return Effect.runPromise(
    host.repository(remoteUrl).pipe(
      Effect.flatMap((repository) =>
        repository === undefined
          ? Effect.die("the host does not serve this remote")
          : repository.pullRequests(heads),
      ),
      Effect.map((byHead) => Object.fromEntries(byHead)),
    ),
  );
}
