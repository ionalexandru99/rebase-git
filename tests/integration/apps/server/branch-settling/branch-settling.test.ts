import { existsSync } from "node:fs";
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { BranchSettlingApi } from "#contracts/branch-settling/branch-settling.contract.ts";
import { RepositoryPullApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { fastImport, git } from "#tests-support/git.ts";
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

  it("deletes branches settled long enough after a fetch with their worktrees, keeping the ones that are unsafe to remove", async () => {
    const pullRequests: Record<
      string,
      { number: number; state: "MERGED"; head: string }[]
    > = {};
    const f = await settlingFixture(fakeGitHub(pullRequests).github);
    const commit = (branch: string) =>
      `commit refs/heads/${branch}\ncommitter Rebase test <rebase@example.test> 1700000000 +0000\ndata ${branch.length}\n${branch}\nfrom refs/heads/main\n\n`;
    await fastImport(
      f.repositoryPath,
      `${commit("squashed")}${commit("unique")}reset refs/heads/fresh\nfrom refs/heads/main\n\n`,
    );
    pullRequests.squashed = [
      {
        number: 9,
        state: "MERGED",
        head: await git(f.repositoryPath, "rev-parse", "squashed"),
      },
    ];
    pullRequests.unique = [
      { number: 10, state: "MERGED", head: "0123456789".repeat(4) },
    ];
    await appendFile(
      join(f.repositoryPath, ".git", "config"),
      ["main", "topic", "mirrored", "elsewhere", "squashed", "unique"]
        .map((branch) => settledConfig(branch))
        .join("") +
        settledConfig("fresh", new Date().toISOString().slice(0, 10)) +
        '[remote "origin"]\n\tfetch = ^refs/heads/squashed\n\tfetch = ^refs/heads/unique\n',
    );
    const worktree = (branch: string) => worktreePath(f, branch);
    await git(f.repositoryPath, "worktree", "add", worktree("topic"), "topic");
    await git(
      f.repositoryPath,
      "worktree",
      "add",
      "--lock",
      worktree("mirrored"),
      "mirrored",
    );
    await git(
      f.repositoryPath,
      "worktree",
      "add",
      worktree("elsewhere"),
      "elsewhere",
    );
    await writeFile(join(worktree("elsewhere"), "draft.txt"), "draft\n");

    await f.fetch();

    await expect
      .poll(f.branches)
      .toEqual(["elsewhere", "fresh", "main", "mirrored", "unique"]);
    expect(existsSync(worktree("topic"))).toBe(false);
    expect(existsSync(worktree("mirrored"))).toBe(true);
  });

  it("keeps settled branches that are being rebased, sit in a moved worktree or were used again", async () => {
    const pullRequests: Record<
      string,
      { number: number; state?: "MERGED"; head?: string }[]
    > = {};
    const f = await settlingFixture(fakeGitHub(pullRequests).github);
    const main = await git(f.repositoryPath, "rev-parse", "main");
    const branches = ["rebasing", "moved", "reopened", "reused", "done"];
    await fastImport(
      f.repositoryPath,
      `${branches.map((branch) => `reset refs/heads/${branch}\nfrom refs/heads/main\n\n`).join("")}commit refs/heads/reused\ncommitter Rebase test <rebase@example.test> 1700000000 +0000\ndata 5\nagain\nfrom refs/heads/main\n\n`,
    );
    pullRequests.reopened = [{ number: 11 }];
    pullRequests.reused = [{ number: 12, state: "MERGED", head: main }];
    await appendFile(
      join(f.repositoryPath, ".git", "config"),
      branches.map((branch) => settledConfig(branch)).join(""),
    );
    const rebasing = worktreePath(f, "rebasing");
    await git(f.repositoryPath, "worktree", "add", "--detach", rebasing);
    const rebaseState = await git(
      rebasing,
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "rebase-merge",
    );
    await mkdir(rebaseState);
    await writeFile(join(rebaseState, "head-name"), "refs/heads/rebasing\n");
    const moved = worktreePath(f, "moved");
    await git(f.repositoryPath, "worktree", "add", moved, "moved");
    await rename(moved, `${moved}-elsewhere`);

    await f.fetch();

    await expect
      .poll(f.branches)
      .toEqual([
        "elsewhere",
        "main",
        "mirrored",
        "moved",
        "rebasing",
        "reopened",
        "reused",
        "topic",
      ]);
    await expect(
      git(f.repositoryPath, "worktree", "list", "--porcelain"),
    ).resolves.toContain(moved.replaceAll("\\", "/"));
  });

  it("stores the settling switch for every client and settles or unsettles the existing branches of a selection by hand", async () => {
    const f = await settlingFixture(fakeGitHub({}).github);
    const scope = {
      repositoryId: f.repositoryId,
      worktreePath: f.repositoryPath,
    };

    await expect(f.settling.settings(scope)).resolves.toEqual({
      autoSettle: true,
      deleteSettledAfter: 3,
    });
    const changed: unknown[] = [];
    f.events.subscribe((_, repositoryIds, kind) =>
      changed.push([repositoryIds, kind]),
    );
    const off = { autoSettle: false, deleteSettledAfter: 0 };
    await expect(
      f.settling.saveSettings({ ...scope, ...off }),
    ).resolves.toEqual(off);
    expect(changed).toEqual([[[f.repositoryId], "Refs"]]);
    await expect(f.settling.settings(scope)).resolves.toEqual(off);

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

function settledConfig(branch: string, day = "2000-01-01") {
  return `[branch "${branch}"]\n\trebaseSettled = ${day}\n\tremote = origin\n\tmerge = refs/heads/${branch}\n`;
}

function worktreePath(f: { readonly repositoryPath: string }, branch: string) {
  return join(f.repositoryPath, "..", `worktree-${branch}`);
}

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
    branches: async () =>
      (await Effect.runPromise(refs.read({ repositoryId }))).branches
        .map(({ name }) => name)
        .sort(),
    settled: async () =>
      Object.fromEntries(
        (await Effect.runPromise(refs.read({ repositoryId }))).branches.flatMap(
          ({ name, settled }) =>
            settled === undefined ? [] : [[name, settled]],
        ),
      ),
  };
}
