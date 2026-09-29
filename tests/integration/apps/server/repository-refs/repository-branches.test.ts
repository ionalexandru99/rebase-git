import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import { RepositoryBranchesApi } from "#contracts/repository-refs/repository-branches.contract.ts";
import {
  cloneRepository,
  createRepository,
  fastImport,
  git,
} from "#tests-support/git.ts";
import {
  openTestEnvironment,
  type RoutesClient,
} from "#tests-support/server.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

describe("repository branches", () => {
  it("creates a branch at a commit and tracks a remote branch", async () => {
    const fixture = await createFixture();
    const base = await git(fixture.repositoryPath, "rev-parse", "main~1");

    const branch = await withBranches(fixture, ({ branches, repositoryId }) =>
      branches.create({
        name: "feature/next",
        repositoryId,
        startPoint: base,
        track: { name: "main", remote: "origin" },
        worktreePath: fixture.repositoryPath,
      }),
    );

    expect(branch).toEqual({
      name: "feature/next",
      target: base,
      upstream: { ahead: 0, behind: 1, gone: false, name: "origin/main" },
    });
  });

  it("rejects invalid, taken, and folder-clashing names", async () => {
    const fixture = await createFixture();
    const head = await git(fixture.repositoryPath, "rev-parse", "HEAD");
    const invalid = ["bad..name", "-x", "HEAD", "@{-1}"];

    const failures = await withBranches(fixture, ({ branches, repositoryId }) =>
      Effect.forEach([...invalid, "main", "spike/deeper"], (name) =>
        branches
          .create({
            name,
            repositoryId,
            startPoint: head,
            worktreePath: fixture.repositoryPath,
          })
          .pipe(Effect.flip),
      ),
    );

    expect(failures).toMatchObject([
      ...invalid.map((name) => ({ _tag: "InvalidBranchName", name })),
      { _tag: "BranchExists", name: "main" },
      { _tag: "BranchExists", name: "spike" },
    ]);
  });

  it("renames the current branch and keeps the worktree on it", async () => {
    const fixture = await createFixture();
    const target = await git(fixture.repositoryPath, "rev-parse", "main");

    const renamed = await withBranches(fixture, ({ branches, repositoryId }) =>
      branches.rename({
        expectedTarget: target,
        name: "main",
        newName: "trunk",
        repositoryId,
        worktreePath: fixture.repositoryPath,
      }),
    );

    expect(renamed).toMatchObject({
      branch: {
        name: "trunk",
        target,
        upstream: { name: "origin/main" },
        worktreePath: fixture.repositoryPath,
      },
      previousName: "main",
    });
    await expect(
      git(fixture.repositoryPath, "symbolic-ref", "--short", "HEAD"),
    ).resolves.toBe("trunk");
  });

  it("renames the unborn branch of an empty repository", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "empty");
    await mkdir(repositoryPath);
    await git(repositoryPath, "init", "-b", "master");

    const renamed = await withBranches(
      { repositoryPath },
      ({ branches, repositoryId }) =>
        branches.rename({
          name: "master",
          newName: "main",
          repositoryId,
          worktreePath: repositoryPath,
        }),
    );

    expect(renamed).toMatchObject({
      branch: { name: "main" },
      previousName: "master",
    });
    await expect(git(repositoryPath, "symbolic-ref", "HEAD")).resolves.toBe(
      "refs/heads/main",
    );
  });

  it("rejects renaming a branch held by another worktree or moved since it was read", async () => {
    const fixture = await createFixture();
    const topic = await git(fixture.repositoryPath, "rev-parse", "topic");
    const _spike = await git(fixture.repositoryPath, "rev-parse", "spike");
    const rename = (name: string, expectedTarget: string) =>
      withBranches(fixture, ({ branches, repositoryId }) =>
        branches.rename({
          expectedTarget,
          name,
          newName: `${name}-renamed`,
          repositoryId,
          worktreePath: fixture.repositoryPath,
        }),
      );

    await expect(rename("topic", topic)).rejects.toMatchObject({
      _tag: "BranchCheckedOutElsewhere",
      name: "topic",
      worktreePath: fixture.worktreePath,
    });
    await expect(rename("spike", topic)).rejects.toMatchObject({
      _tag: "BranchMoved",
      name: "spike",
    });
  });

  it("deletes a merged branch at once and returns its target for undo", async () => {
    const fixture = await createFixture();
    const merged = await git(fixture.repositoryPath, "rev-parse", "merged");

    const deleted = await withBranches(fixture, ({ branches, repositoryId }) =>
      branches.delete({
        force: false,
        local: { name: "merged", target: merged },
        repositoryId,
        worktreePath: fixture.repositoryPath,
      }),
    );

    expect(deleted).toEqual({ local: { name: "merged", target: merged } });
    await expect(
      git(fixture.repositoryPath, "branch", "--list", "merged"),
    ).resolves.toBe("");
  });

  it("lists the commits only on an unmerged branch and deletes it when forced", async () => {
    const fixture = await createFixture();
    const spike = await git(fixture.repositoryPath, "rev-parse", "spike");
    const remove = (force: boolean) =>
      withBranches(fixture, ({ branches, repositoryId }) =>
        branches.delete({
          force,
          local: { name: "spike", target: spike },
          repositoryId,
          worktreePath: fixture.repositoryPath,
        }),
      );

    await expect(remove(false)).rejects.toMatchObject({
      _tag: "BranchNotMerged",
      commits: [{ oid: spike, subject: "spike two" }, { subject: "spike one" }],
      count: 2,
      name: "spike",
    });
    await expect(remove(true)).resolves.toEqual({
      local: { name: "spike", target: spike },
    });
  });

  it("rejects deleting a checked-out or moved branch", async () => {
    const fixture = await createFixture();
    const main = await git(fixture.repositoryPath, "rev-parse", "main");
    const topic = await git(fixture.repositoryPath, "rev-parse", "topic");
    const remove = (name: string, expectedTarget: string) =>
      withBranches(fixture, ({ branches, repositoryId }) =>
        branches.delete({
          force: true,
          local: { name, target: expectedTarget },
          repositoryId,
          worktreePath: fixture.repositoryPath,
        }),
      );

    await expect(remove("main", main)).rejects.toMatchObject({
      _tag: "BranchCheckedOutElsewhere",
      name: "main",
    });
    await expect(remove("topic", topic)).rejects.toMatchObject({
      _tag: "BranchCheckedOutElsewhere",
      worktreePath: fixture.worktreePath,
    });
    await expect(remove("spike", main)).rejects.toMatchObject({
      _tag: "BranchMoved",
      name: "spike",
    });
  });

  it("deletes a branch locally and on the remote after warning about commits only there", async () => {
    const fixture = await createFixture();
    await git(fixture.repositoryPath, "push", "-u", "origin", "spike");
    const spike = await git(fixture.repositoryPath, "rev-parse", "spike");
    const remove = (force: boolean) =>
      withBranches(fixture, ({ branches, repositoryId }) =>
        branches.delete({
          force,
          local: { name: "spike", target: spike },
          remote: { name: "spike", remote: "origin", target: spike },
          repositoryId,
          worktreePath: fixture.repositoryPath,
        }),
      );

    await expect(remove(false)).rejects.toMatchObject({
      _tag: "BranchNotMerged",
      count: 2,
      name: "spike",
    });
    await expect(remove(true)).resolves.toEqual({
      local: { name: "spike", target: spike },
      remote: { name: "spike", remote: "origin", target: spike },
    });
    await expect(
      git(fixture.repositoryPath, "ls-remote", "--heads", "origin", "spike"),
    ).resolves.toBe("");
    await expect(
      git(fixture.repositoryPath, "branch", "--all", "--list", "*spike"),
    ).resolves.toBe("");
    await expect(
      git(
        fixture.repositoryPath,
        "config",
        "--get-regexp",
        "^branch\\.spike\\.",
      ),
    ).rejects.toThrow();
  });

  it("refuses to delete a remote branch that someone else moved", async () => {
    const fixture = await createFixture();
    await git(fixture.repositoryPath, "push", "origin", "main:shared");
    await git(fixture.repositoryPath, "fetch", "origin");
    const seen = await git(
      fixture.repositoryPath,
      "rev-parse",
      "origin/shared",
    );
    const teammate = join(fixture.root, "teammate");
    await cloneRepository(join(fixture.root, "origin.git"), teammate, "-q");
    await git(teammate, "checkout", "-q", "shared");
    await git(teammate, "commit", "--allow-empty", "-m", "teammate work");
    await git(teammate, "push", "-q", "origin", "shared");

    await expect(
      withBranches(fixture, ({ branches, repositoryId }) =>
        branches.delete({
          force: true,
          remote: { name: "shared", remote: "origin", target: seen },
          repositoryId,
          worktreePath: fixture.repositoryPath,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "BranchMoved", name: "origin/shared" });
    await expect(
      git(fixture.repositoryPath, "ls-remote", "--heads", "origin", "shared"),
    ).resolves.not.toBe("");
  });
});

async function withBranches<Value, Failure>(
  fixture: Pick<Fixture, "repositoryPath">,
  use: (dependencies: {
    readonly branches: RoutesClient<typeof RepositoryBranchesApi>;
    readonly repositoryId: string;
  }) => Effect.Effect<Value, Failure>,
) {
  const environment = await openTestEnvironment();
  const repository = await environment.remember(fixture.repositoryPath);
  return Effect.runPromise(
    use({
      branches: environment.routes(RepositoryBranchesApi),
      repositoryId: repository.id,
    }),
  );
}

async function createFixture(): Promise<Fixture> {
  const root = await createTemporaryDirectory();
  const originPath = join(root, "origin.git");
  const repositoryPath = join(root, "repository");
  const worktreePath = join(root, "topic worktree");
  await mkdir(originPath);
  await git(originPath, "init", "--bare", "-b", "main");
  await createRepository(repositoryPath, { commits: [] });
  await git(repositoryPath, "remote", "add", "origin", originPath);
  const commit = (branch: string, message: string, from?: string) =>
    `commit refs/heads/${branch}\ncommitter Rebase test <rebase@example.test> 0 +0000\ndata <<END\n${message}\nEND\n${from === undefined ? "" : `from ${from}\n`}\n`;
  await fastImport(
    repositoryPath,
    [
      commit("main", "initial"),
      "reset refs/heads/merged\nfrom refs/heads/main\n\n",
      commit("main", "second"),
      commit("spike", "spike one", "refs/heads/main"),
      commit("spike", "spike two"),
    ].join(""),
  );
  await git(repositoryPath, "push", "-u", "origin", "main");
  await git(repositoryPath, "worktree", "add", worktreePath, "-b", "topic");
  return { repositoryPath, root, worktreePath };
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase branches "));
  onTestFinished(() => removeTemporaryDirectory(directory));
  return realpath(directory);
}

interface Fixture {
  readonly repositoryPath: string;
  readonly root: string;
  readonly worktreePath: string;
}
