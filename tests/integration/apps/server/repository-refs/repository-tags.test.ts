import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import {
  createTag,
  deleteTag,
} from "#server/features/repository-refs/git/repository-tags";
import { createRepository, git } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const runner = createLocalGitCommandRunner();
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => removeTemporaryDirectory(path)),
  );
});

describe("repository tags", () => {
  it("creates a lightweight tag and refuses a duplicate or invalid name", async () => {
    const { worktreePath, head } = await fixture();
    const create = (name: string) =>
      Effect.runPromise(
        createTag(runner, { name, repositoryId, target: head, worktreePath }),
      );

    await expect(create("v1.0")).resolves.toEqual({
      name: "v1.0",
      target: head,
    });
    await expect(
      git(worktreePath, "cat-file", "-t", "refs/tags/v1.0"),
    ).resolves.toBe("commit");
    await expect(create("v1.0")).rejects.toMatchObject({
      _tag: "TagRejected",
      reason: "Exists",
    });
    for (const name of ["bad..name", "-x", "release/"])
      await expect(create(name)).rejects.toMatchObject({
        _tag: "TagRejected",
        reason: "InvalidName",
      });
  });

  it("deletes a tag and reports one that is already gone", async () => {
    const { worktreePath, head } = await fixture();
    await git(worktreePath, "tag", "v1.0");
    await git(worktreePath, "tag", "snapshot", "HEAD^{tree}");
    const remove = (name: string) =>
      Effect.runPromise(
        deleteTag(runner, { name, repositoryId, worktreePath }),
      );

    await expect(remove("v1.0")).resolves.toEqual({
      name: "v1.0",
      target: head,
    });
    await expect(remove("snapshot")).resolves.toMatchObject({
      name: "snapshot",
    });
    await expect(git(worktreePath, "tag", "--list")).resolves.toBe("");
    await expect(remove("v1.0")).rejects.toMatchObject({
      _tag: "RefMissing",
      name: "v1.0",
    });
  });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rebase tags ")));
  directories.push(root);
  const worktreePath = join(root, "repository");
  await createRepository(worktreePath);
  return { worktreePath, head: await git(worktreePath, "rev-parse", "HEAD") };
}
