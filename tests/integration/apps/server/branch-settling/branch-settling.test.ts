import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { BranchSettlingApi } from "#contracts/branch-settling/branch-settling.contract.ts";
import { RepositoryPullApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { git } from "#tests-support/git.ts";
import { fakeGitHub } from "#tests-support/git-hosts/github.ts";
import { pullRequestsFixture } from "#tests-support/git-hosts/pull-requests-fixture.ts";

const remoteUrl = "git@github.com:Octo/rebase.git";
const day = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/);

describe("branch settling", () => {
  it("settles branches whose pull request merged after a fetch, except the main checkout and branches kept active", async () => {
    const { github, requests } = fakeGitHub({
      "remote-topic": [{ number: 7, state: "MERGED" }],
      main: [{ number: 1, state: "MERGED" }],
      mirrored: [{ number: 3, state: "MERGED" }, { number: 4 }],
      elsewhere: [{ number: 5, state: "MERGED" }],
    });
    const f = await settlingFixture(github);
    await f.track("topic", "origin", "remote-topic");
    await f.track("main", "origin", "main");
    await f.track("mirrored", "origin", "mirrored");
    await f.track("elsewhere", "origin", "elsewhere");
    await git(
      f.repositoryPath,
      "config",
      "branch.elsewhere.rebaseSettled",
      "false",
    );

    await f.fetch();

    await expect.poll(f.settled).toEqual({ topic: day });
    expect(requests).toEqual([
      { owner: "Octo", name: "rebase", b0: "mirrored", b1: "remote-topic" },
    ]);
  });

  it("stores the settling switch and settles or unsettles the existing branches of a selection by hand", async () => {
    const f = await settlingFixture(fakeGitHub({}).github);
    const scope = {
      repositoryId: f.repositoryId,
      worktreePath: f.repositoryPath,
    };

    await expect(f.settling.settings(scope)).resolves.toEqual({
      autoSettle: true,
    });
    await expect(
      f.settling.saveSettings({ ...scope, autoSettle: false }),
    ).resolves.toEqual({ autoSettle: false });
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
