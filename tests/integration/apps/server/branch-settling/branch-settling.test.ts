import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { BranchSettlingApi } from "#contracts/branch-settling/branch-settling.contract.ts";
import { RepositoryPullApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { git } from "#tests-support/git.ts";
import { fakeGitHub } from "#tests-support/git-hosts/github.ts";
import { pullRequestsFixture } from "#tests-support/git-hosts/pull-requests-fixture.ts";

const remoteUrl = "git@github.com:Octo/rebase.git";

type PullRequestNode = {
  readonly number: number;
  readonly state?: "MERGED";
  readonly head?: string;
};
const day = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/);

describe("branch settling", () => {
  it("settles branches whose merged pull request holds their tip after a fetch, except the main checkout, the remote default branch and branches kept active", async () => {
    const byHead: Record<string, PullRequestNode[]> = {};
    const { github, requests } = fakeGitHub(byHead);
    const f = await settlingFixture(github);
    const tip = await git(f.repositoryPath, "rev-parse", "HEAD");
    const later = await git(
      f.repositoryPath,
      "commit-tree",
      "HEAD^{tree}",
      "-p",
      "HEAD",
      "-m",
      "later",
    );
    await git(f.repositoryPath, "branch", "reused", later);
    await git(f.repositoryPath, "branch", "release");
    await git(
      f.repositoryPath,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/release",
    );
    const merged = (head: string) =>
      ({ number: 1, state: "MERGED", head }) as const;
    Object.assign(byHead, {
      "remote-topic": [merged(later.slice(0, 12))],
      main: [merged(tip)],
      mirrored: [merged(tip), { number: 4 }],
      elsewhere: [merged(tip)],
      reused: [merged(tip), merged("f".repeat(40))],
      release: [merged(tip)],
    });
    await f.track("topic", "origin", "remote-topic");
    for (const branch of ["main", "mirrored", "elsewhere", "reused", "release"])
      await f.track(branch, "origin", branch);
    await git(
      f.repositoryPath,
      "config",
      "branch.elsewhere.rebaseSettled",
      "false",
    );

    await f.fetch();

    await expect.poll(f.settled).toEqual({ topic: day });
    expect(requests).toEqual([
      {
        owner: "Octo",
        name: "rebase",
        b0: "mirrored",
        b1: "reused",
        b2: "remote-topic",
      },
    ]);
  });

  it("stores the settling switch for every client and settles or unsettles the existing branches of a selection by hand", async () => {
    const f = await settlingFixture(fakeGitHub({}).github);
    const scope = {
      repositoryId: f.repositoryId,
      worktreePath: f.repositoryPath,
    };

    await expect(f.settling.settings(scope)).resolves.toEqual({
      autoSettle: true,
    });
    const changed: unknown[] = [];
    f.events.subscribe((_, repositoryIds, kind) =>
      changed.push([repositoryIds, kind]),
    );
    await expect(
      f.settling.saveSettings({ ...scope, autoSettle: false }),
    ).resolves.toEqual({ autoSettle: false });
    expect(changed).toEqual([[[f.repositoryId], "Refs"]]);
    await expect(f.settling.settings(scope)).resolves.toEqual({
      autoSettle: false,
    });

    await f.settling.settle({
      ...scope,
      names: ["topic", "mirrored", "deleted"],
      settled: true,
    });
    expect(await f.settled()).toEqual({ topic: day, mirrored: day });
    await expect(
      git(f.repositoryPath, "config", "branch.deleted.rebaseSettled"),
    ).rejects.toThrow();
    await f.settling.settle({ ...scope, names: ["topic"], settled: false });
    expect(await f.settled()).toEqual({ mirrored: day });
    await expect(
      git(f.repositoryPath, "config", "branch.topic.rebaseSettled"),
    ).resolves.toBe("false");
  });
});

async function settlingFixture(
  github: ReturnType<typeof fakeGitHub>["github"],
) {
  const f = await pullRequestsFixture({ origin: remoteUrl }, { github });
  await git(
    f.repositoryPath,
    "config",
    `url.${f.repositoryPath}.insteadOf`,
    remoteUrl,
  );
  const repositoryId = f.repositoryId;
  const refs = f.routes(RepositoryRefsApi);
  const pull = f.routes(RepositoryPullApi);
  const settling = f.routes(BranchSettlingApi);
  return {
    ...f,
    settling: {
      settings: (input: Parameters<typeof settling.settings>[0]) =>
        Effect.runPromise(settling.settings(input)),
      saveSettings: (input: Parameters<typeof settling.saveSettings>[0]) =>
        Effect.runPromise(settling.saveSettings(input)),
      settle: (input: Parameters<typeof settling.settle>[0]) =>
        Effect.runPromise(settling.settle(input)),
    },
    fetch: () => Effect.runPromise(pull.fetch({ repositoryId })),
    settled: async () =>
      Object.fromEntries(
        (await Effect.runPromise(refs.read({ repositoryId }))).branches.flatMap(
          ({ name, settled }) =>
            settled === undefined ? [] : [[name, settled]],
        ),
      ),
  };
}
