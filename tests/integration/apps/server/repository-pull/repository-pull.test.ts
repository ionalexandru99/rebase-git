import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepositoryPullHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { repositoryPullFeature } from "#server/features/repository-pull/index";
import {
  createRepositoryAccess,
  createRepositoryCoordination,
} from "#server/repository/access/index";
import { repositoryFeatureClient } from "#tests-integration/apps/server/environment-connection/feature-routes-client";
import { cloneRepository, fastImport, git } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => removeTemporaryDirectory(path)),
  );
});

describe("fast-forward pull", () => {
  it("fast-forwards the checked-out branch and keeps unrelated local edits", async () => {
    const f = await fixture();
    const incoming = await f.publish("main", "other.txt", "remote");
    await git(f.repositoryPath, "fetch");
    await writeFile(join(f.repositoryPath, "file.txt"), "local edit\n");

    await expect(f.pull("main")).resolves.toEqual({
      outcome: "FastForwarded",
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
    await expect(f.pull("main")).resolves.toEqual({ outcome: "UpToDate" });

    await git(f.repositoryPath, "commit", "--allow-empty", "-m", "local");
    await expect(f.pull("main")).resolves.toEqual({ outcome: "UpToDate" });
  });

  it("refuses a diverged branch without changing it", async () => {
    const f = await fixture();
    await f.publish("main", "other.txt", "remote\n");
    await git(f.repositoryPath, "fetch");
    await git(f.repositoryPath, "commit", "--allow-empty", "-m", "local");
    const local = await git(f.repositoryPath, "rev-parse", "HEAD");

    await expect(f.pull("main")).rejects.toMatchObject({
      _tag: "PullDiverged",
      upstream: "origin/main",
    });
    expect(await git(f.repositoryPath, "rev-parse", "HEAD")).toBe(local);
  });

  it("keeps overlapping local edits when Git refuses the update", async () => {
    const f = await fixture();
    await f.publish("main", "file.txt", "remote\n");
    await git(f.repositoryPath, "fetch");
    const local = await git(f.repositoryPath, "rev-parse", "HEAD");
    await writeFile(join(f.repositoryPath, "file.txt"), "local edit\n");

    await expect(f.pull("main")).rejects.toMatchObject({
      _tag: "PullWouldOverwrite",
      paths: ["file.txt"],
    });
    expect(await git(f.repositoryPath, "rev-parse", "HEAD")).toBe(local);
    expect(await readFile(join(f.repositoryPath, "file.txt"), "utf8")).toBe(
      "local edit\n",
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

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rebase pull ")));
  directories.push(root);
  const originPath = join(root, "origin.git");
  const repositoryPath = join(root, "repository");
  await git(root, "init", "--bare", "-b", "main", originPath);
  await commitFile(originPath, {
    branch: "main",
    file: "file.txt",
    content: "base\n",
  });
  await cloneRepository(originPath, repositoryPath);

  const runner = createLocalGitCommandRunner();
  const service = repositoryFeatureClient(
    RepositoryPullHttpApi,
    repositoryPullFeature,
    {
      access: createRepositoryAccess(
        {
          find: () =>
            Effect.succeed({
              id: repositoryId,
              path: repositoryPath,
              name: "repository",
              addedAt: "",
              lastOpenedAt: "",
            }),
        },
        runner,
        createLocalRepositoryWatcher(),
      ),
      git: runner,
      coordination: createRepositoryCoordination(runner),
    },
  );
  return {
    repositoryPath,
    pull: (branch: string) =>
      Effect.runPromise(
        service.pull({ repositoryId, worktreePath: repositoryPath, branch }),
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
