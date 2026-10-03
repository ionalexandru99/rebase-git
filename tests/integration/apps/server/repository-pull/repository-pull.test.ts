import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  type PullBranch,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import { cloneRepository, fastImport, git } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

describe("fast-forward pull", () => {
  it("fast-forwards the checked-out branch and keeps unrelated local edits", async () => {
    const f = await fixture();
    const incoming = await f.publish("main", "other.txt", "remote");
    await git(f.repositoryPath, "fetch");
    await writeFile(join(f.repositoryPath, "file.txt"), "local edit\n");

    await expect(f.pull("main")).resolves.toEqual({
      outcome: "FastForwarded",
      stashKept: false,
    });

    expect(await git(f.repositoryPath, "rev-parse", "HEAD")).toBe(incoming);
    expect(await readFile(join(f.repositoryPath, "file.txt"), "utf8")).toBe(
      "local edit\n",
    );
    expect(await readFile(join(f.repositoryPath, "other.txt"), "utf8")).toBe(
      "remote",
    );
  });

  it("reports an up-to-date branch, including one that is only ahead", async () => {
    const f = await fixture();
    const upToDate = { outcome: "UpToDate", stashKept: false };
    await expect(f.pull("main")).resolves.toEqual(upToDate);

    await git(f.repositoryPath, "commit", "--allow-empty", "-m", "local");
    await expect(f.pull("main")).resolves.toEqual(upToDate);
  });

  it("keeps overlapping local edits in the stash list when Git cannot put them back", async () => {
    const f = await fixture();
    const incoming = await f.publish("main", "file.txt", "remote\n");
    await git(f.repositoryPath, "fetch");
    await writeFile(join(f.repositoryPath, "file.txt"), "local edit\n");

    await expect(f.pull("main")).resolves.toEqual({
      outcome: "FastForwarded",
      stashKept: true,
    });

    expect(await git(f.repositoryPath, "rev-parse", "HEAD")).toBe(incoming);
    expect(await git(f.repositoryPath, "stash", "list")).not.toBe("");
  });

  it("refuses an untracked file that the update would overwrite", async () => {
    const f = await fixture();
    await f.publish("main", "other.txt", "remote\n");
    await git(f.repositoryPath, "fetch");
    const local = await git(f.repositoryPath, "rev-parse", "HEAD");
    await writeFile(join(f.repositoryPath, "other.txt"), "untracked\n");

    await expect(f.pull("main")).rejects.toMatchObject({
      _tag: "PullWouldOverwrite",
      paths: ["other.txt"],
    });
    expect(await git(f.repositoryPath, "rev-parse", "HEAD")).toBe(local);
    expect(await readFile(join(f.repositoryPath, "other.txt"), "utf8")).toBe(
      "untracked\n",
    );
  });

  it("stops at the fetched commit when the remote moves again", async () => {
    const f = await fixture();
    const fetched = await f.publish("main", "other.txt", "first\n");
    await git(f.repositoryPath, "fetch");
    await f.publish("main", "other.txt", "second\n");

    await f.pull("main");

    expect(await git(f.repositoryPath, "rev-parse", "HEAD")).toBe(fetched);
  });

  it("fast-forwards a branch that is not checked out", async () => {
    const f = await fixture();
    await git(f.repositoryPath, "branch", "feature");
    await git(f.repositoryPath, "push", "-u", "origin", "feature");
    const incoming = await f.publish("feature", "other.txt", "remote\n");
    await git(f.repositoryPath, "fetch");

    await expect(f.pull("feature")).resolves.toEqual({
      outcome: "FastForwarded",
      stashKept: false,
    });

    expect(await git(f.repositoryPath, "rev-parse", "feature")).toBe(incoming);
    expect(await git(f.repositoryPath, "branch", "--show-current")).toBe(
      "main",
    );
    expect(await git(f.repositoryPath, "status", "--porcelain")).toBe("");
  });

  it("fast-forwards the worktree that holds the branch", async () => {
    const f = await fixture();
    const linked = join(f.repositoryPath, "..", "linked");
    await git(f.repositoryPath, "branch", "feature");
    await git(f.repositoryPath, "push", "-u", "origin", "feature");
    await git(f.repositoryPath, "worktree", "add", linked, "feature");
    const incoming = await f.publish("feature", "other.txt", "remote\n");
    await git(f.repositoryPath, "fetch");

    await expect(f.pull("feature")).resolves.toEqual({
      outcome: "FastForwarded",
      stashKept: false,
    });

    expect(await git(linked, "rev-parse", "HEAD")).toBe(incoming);
    expect(await readFile(join(linked, "other.txt"), "utf8")).toBe("remote\n");
    expect(await git(f.repositoryPath, "branch", "--show-current")).toBe(
      "main",
    );
  });

  it("fast-forwards a clean linked worktree while the active worktree is merging", async () => {
    const f = await fixture();
    const linked = join(f.repositoryPath, "..", "linked");
    await git(f.repositoryPath, "branch", "feature");
    await git(f.repositoryPath, "push", "-u", "origin", "feature");
    await commitFile(f.repositoryPath, {
      branch: "topic",
      parent: "main",
      file: "file.txt",
      content: "topic\n",
    });
    await writeFile(join(f.repositoryPath, "file.txt"), "main\n");
    await git(f.repositoryPath, "commit", "-am", "main");
    await git(f.repositoryPath, "worktree", "add", linked, "feature");
    const incoming = await f.publish("feature", "other.txt", "remote\n");
    await git(f.repositoryPath, "fetch");
    await expect(git(f.repositoryPath, "merge", "topic")).rejects.toThrow();

    await expect(f.pull("feature")).resolves.toEqual({
      outcome: "FastForwarded",
      stashKept: false,
    });

    expect(await git(linked, "rev-parse", "HEAD")).toBe(incoming);
  });

  it("explains missing and deleted upstreams", async () => {
    const f = await fixture();
    await git(f.repositoryPath, "branch", "untracked");
    await expect(f.pull("untracked")).rejects.toMatchObject({
      _tag: "UpstreamMissing",
    });

    await git(f.repositoryPath, "switch", "-c", "feature");
    await git(f.repositoryPath, "push", "-u", "origin", "feature");
    await git(f.repositoryPath, "push", "origin", "--delete", "feature");
    await git(f.repositoryPath, "fetch", "--prune");
    await expect(f.pull("feature")).rejects.toMatchObject({
      _tag: "UpstreamMissing",
      upstream: "origin/feature",
    });
  });

  it("refuses to pull while a merge is in progress", async () => {
    const f = await fixture();
    await git(f.repositoryPath, "switch", "-c", "topic");
    await writeFile(join(f.repositoryPath, "file.txt"), "topic\n");
    await git(f.repositoryPath, "commit", "-am", "topic");
    await git(f.repositoryPath, "switch", "main");
    await writeFile(join(f.repositoryPath, "file.txt"), "main\n");
    await git(f.repositoryPath, "commit", "-am", "main");
    await expect(git(f.repositoryPath, "merge", "topic")).rejects.toThrow();

    await expect(f.pull("main")).rejects.toMatchObject({
      _tag: "RepositoryRejected",
      reason: "Incompatible",
      detail: expect.stringMatching(/merge is in progress/),
    });
  });
});

describe("diverged pull", () => {
  it("asks for a choice and names the upstream commit it saw", async () => {
    const f = await divergedFixture();

    await expect(f.pull("main")).rejects.toEqual({
      _tag: "PullDiverged",
      upstream: "origin/main",
      upstreamCommit: f.incoming,
    });
    expect(await git(f.repositoryPath, "rev-parse", "HEAD")).toBe(f.local);
  });

  it("rebases the local commits onto the upstream and puts local edits back", async () => {
    const f = await divergedFixture();
    await writeFile(join(f.repositoryPath, "file.txt"), "local edit\n");

    await expect(
      f.pull("main", { kind: "rebase", upstream: f.incoming }),
    ).resolves.toEqual({ outcome: "Rebased", stashKept: false });

    expect(await git(f.repositoryPath, "rev-parse", "HEAD~1")).toBe(f.incoming);
    expect(await readFile(join(f.repositoryPath, "file.txt"), "utf8")).toBe(
      "local edit\n",
    );
    expect(await git(f.repositoryPath, "stash", "list")).toBe("");
  });

  it("rebases an earlier local merge into a straight line", async () => {
    const f = await divergedFixture();
    await commitFile(f.repositoryPath, {
      branch: "topic",
      parent: "main",
      file: "topic.txt",
      content: "topic\n",
    });
    await git(f.repositoryPath, "merge", "--no-ff", "-m", "merge", "topic");

    await expect(
      f.pull("main", { kind: "rebase", upstream: f.incoming }),
    ).resolves.toEqual({ outcome: "Rebased", stashKept: false });

    expect(await git(f.repositoryPath, "rev-list", "--merges", "HEAD")).toBe(
      "",
    );
    expect(
      await git(f.repositoryPath, "rev-list", "--count", `${f.incoming}..HEAD`),
    ).toBe("2");
  });

  it("merges the upstream with the setting saved for the repository", async () => {
    const f = await divergedFixture();
    await f.save("merge");

    await expect(f.pull("main")).resolves.toEqual({
      outcome: "Merged",
      stashKept: false,
    });

    expect(await git(f.repositoryPath, "rev-parse", "HEAD^1", "HEAD^2")).toBe(
      `${f.local}\n${f.incoming}`,
    );
  });

  it("refuses a choice made for an upstream commit that has since moved", async () => {
    const f = await divergedFixture();
    await f.publish("main", "other.txt", "again\n");
    await git(f.repositoryPath, "fetch");

    await expect(
      f.pull("main", { kind: "merge", upstream: f.incoming }),
    ).rejects.toEqual({ _tag: "UpstreamMoved" });
    expect(await git(f.repositoryPath, "rev-parse", "HEAD")).toBe(f.local);
  });

  it.each(["rebase", "merge"] as const)(
    "refuses an untracked file that the %s would overwrite",
    async (kind) => {
      const f = await divergedFixture();
      await writeFile(join(f.repositoryPath, "other.txt"), "untracked\n");

      await expect(
        f.pull("main", { kind, upstream: f.incoming }),
      ).rejects.toEqual({ _tag: "PullWouldOverwrite", paths: ["other.txt"] });
      expect(await git(f.repositoryPath, "rev-parse", "HEAD")).toBe(f.local);
      expect(await readFile(join(f.repositoryPath, "other.txt"), "utf8")).toBe(
        "untracked\n",
      );
    },
  );

  it("merges and keeps overlapping local edits in the stash list when Git cannot put them back", async () => {
    const f = await divergedFixture({ incoming: "file.txt" });
    await writeFile(join(f.repositoryPath, "file.txt"), "local edit\n");

    await expect(
      f.pull("main", { kind: "merge", upstream: f.incoming }),
    ).resolves.toEqual({ outcome: "Merged", stashKept: true });

    expect(await git(f.repositoryPath, "rev-parse", "HEAD^2")).toBe(f.incoming);
    expect(await git(f.repositoryPath, "stash", "list")).not.toBe("");
  });

  it("refuses to merge an upstream with unrelated history without naming the remote", async () => {
    const f = await fixture();
    await git(f.repositoryPath, "switch", "--orphan", "unrelated");
    await git(f.repositoryPath, "commit", "--allow-empty", "-m", "unrelated");
    await git(f.repositoryPath, "branch", "--set-upstream-to=origin/main");
    const upstream = await git(f.repositoryPath, "rev-parse", "origin/main");

    await expect(
      f.pull("unrelated", { kind: "merge", upstream }),
    ).rejects.toEqual({
      _tag: "PullBlocked",
      detail: "The remote branch has no history in common.",
    });
  });

  it("stops on a conflicting rebase and hands over the operation", async () => {
    const f = await divergedFixture({ local: "other.txt" });

    await expect(
      f.pull("main", { kind: "rebase", upstream: f.incoming }),
    ).resolves.toMatchObject({
      outcome: "Stopped",
      worktreePath: f.repositoryPath,
      operation: {
        kind: "rebase",
        phase: "conflicts",
        unresolvedPaths: ["other.txt"],
      },
    });
  });
});

async function divergedFixture({
  incoming: incomingFile = "other.txt",
  local: localFile = "local.txt",
} = {}) {
  const f = await fixture();
  const incoming = await f.publish("main", incomingFile, "remote\n");
  await git(f.repositoryPath, "fetch");
  await writeFile(join(f.repositoryPath, localFile), "local\n");
  await git(f.repositoryPath, "add", localFile);
  await git(f.repositoryPath, "commit", "-m", "local");
  const local = await git(f.repositoryPath, "rev-parse", "HEAD");
  return { ...f, incoming, local };
}

async function fixture() {
  const environment = await openTestEnvironment();
  const root = environment.home;
  const originPath = join(root, "origin.git");
  const repositoryPath = join(root, "repository");
  await git(root, "init", "--bare", "-b", "main", originPath);
  await commitFile(originPath, {
    branch: "main",
    file: "file.txt",
    content: "base\n",
  });
  await cloneRepository(
    originPath,
    repositoryPath,
    "--config",
    "user.name=Rebase test",
    "--config",
    "user.email=rebase@example.test",
  );

  const repositoryId = (await environment.remember(repositoryPath)).id;
  const service = environment.routes(RepositoryPullApi);
  return {
    repositoryPath,
    pull: (branch: string, strategy?: PullBranch["strategy"]) =>
      Effect.runPromise(
        service.pull({
          repositoryId,
          worktreePath: repositoryPath,
          branch,
          ...(strategy === undefined ? {} : { strategy }),
        }),
      ),
    save: (strategy: "merge" | "rebase") =>
      Effect.runPromise(
        service.saveRepositoryPullStrategy({ repositoryId, strategy }),
      ),
    publish: (branch: string, file: string, content: string) =>
      commitFile(originPath, { branch, parent: branch, file, content }),
  };
}

async function commitFile(
  path: string,
  commit: {
    readonly branch: string;
    readonly parent?: string;
    readonly file: string;
    readonly content: string;
  },
) {
  const parent =
    commit.parent === undefined ? "" : `from refs/heads/${commit.parent}^0\n`;
  await fastImport(
    path,
    `commit refs/heads/${commit.branch}\ncommitter Rebase test <rebase@example.test> 0 +0000\ndata <<END\nupdate ${commit.file}\nEND\n${parent}M 100644 inline ${commit.file}\ndata ${Buffer.byteLength(commit.content)}\n${commit.content}\n`,
  );
  return git(path, "rev-parse", `refs/heads/${commit.branch}`);
}
