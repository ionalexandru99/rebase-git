import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { DeleteRepositoryTag } from "#contracts/repository-refs/repository-tags.contract.ts";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import {
  createTag,
  deleteTag,
  readTagAnnotation,
} from "#server/features/repository-refs/git/repository-tags.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

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

  it("creates an annotated tag that points at its commit through a tag object", async () => {
    const { worktreePath, head } = await fixture();

    const created = await Effect.runPromise(
      createTag(runner, {
        name: "v2.0",
        message: "Release 2.0\n\nFaster graph.",
        repositoryId,
        target: head,
        worktreePath,
      }),
    );

    expect(created).toEqual({
      name: "v2.0",
      target: head,
      object: await git(worktreePath, "rev-parse", "refs/tags/v2.0"),
    });
    expect(created.object).not.toBe(head);
    await expect(
      Effect.runPromise(
        readTagAnnotation(runner, { name: "v2.0", repositoryId, worktreePath }),
      ),
    ).resolves.toMatchObject({
      object: created.object,
      target: head,
      tagger: { name: "Tag author" },
      message: "Release 2.0\n\nFaster graph.",
      signed: false,
    });
  });

  it("reads a signed tag's message without its signature", async () => {
    const { worktreePath, head } = await fixture();
    const object = await git(
      worktreePath,
      "hash-object",
      "-t",
      "tag",
      "-w",
      await tagFile(worktreePath, head),
    );
    await git(worktreePath, "update-ref", "refs/tags/signed", object);

    await expect(
      Effect.runPromise(
        readTagAnnotation(runner, {
          name: "signed",
          repositoryId,
          worktreePath,
        }),
      ),
    ).resolves.toMatchObject({ message: "Signed release", signed: true });
  });

  it("follows the Environment's signing settings", async () => {
    const { worktreePath, head } = await fixture();
    await git(worktreePath, "config", "tag.gpgSign", "true");
    await git(worktreePath, "config", "gpg.format", "ssh");
    await git(
      worktreePath,
      "config",
      "user.signingKey",
      join(worktreePath, "missing-key"),
    );
    const create = (message?: string) =>
      Effect.runPromise(
        createTag(runner, {
          name: "v3.0",
          repositoryId,
          target: head,
          worktreePath,
          ...(message === undefined ? {} : { message }),
        }),
      );

    await expect(create()).rejects.toMatchObject({
      _tag: "TagRejected",
      reason: "MessageRequired",
    });
    await expect(create("Signed release")).rejects.toMatchObject({
      _tag: "RepositoryRejected",
    });
    await expect(git(worktreePath, "tag", "--list")).resolves.toBe("");
  });

  it("deletes a local tag only while it is the tag that was shown", async () => {
    const { worktreePath, head } = await fixture();
    await git(worktreePath, "tag", "--no-sign", "v1.0");
    await git(worktreePath, "tag", "--no-sign", "snapshot", "HEAD^{tree}");
    const tree = await git(worktreePath, "rev-parse", "HEAD^{tree}");
    const remove = (name: string, object: string) =>
      Effect.runPromise(
        deleteTag(runner, {
          name,
          local: { object },
          repositoryId,
          worktreePath,
        }),
      );

    await expect(remove("v1.0", tree)).rejects.toMatchObject({
      _tag: "TagRejected",
      reason: "Moved",
    });
    await expect(remove("v1.0", head)).resolves.toEqual({ name: "v1.0" });
    await expect(remove("snapshot", tree)).resolves.toEqual({
      name: "snapshot",
    });
    await expect(git(worktreePath, "tag", "--list")).resolves.toBe("");
    await expect(remove("v1.0", head)).rejects.toMatchObject({
      _tag: "RefMissing",
      name: "v1.0",
    });
  });

  it("deletes a tag on a remote only when the remote has the same tag", async () => {
    const { root, worktreePath, head } = await fixture();
    const remote = join(root, "remote.git");
    await git(root, "init", "--bare", remote);
    await git(worktreePath, "remote", "add", "origin", remote);
    await git(worktreePath, "tag", "--no-sign", "v1.0");
    await git(worktreePath, "push", "origin", "refs/tags/v1.0");
    const tree = await git(worktreePath, "rev-parse", "HEAD^{tree}");
    const remove = (object: string) =>
      Effect.runPromise(
        deleteTag(runner, {
          name: "v1.0",
          remote: { remote: "origin", object },
          repositoryId,
          worktreePath,
        } satisfies DeleteRepositoryTag),
      );

    await expect(remove(tree)).rejects.toMatchObject({
      _tag: "TagRejected",
      reason: "RemoteDiffers",
    });
    await expect(remove(head)).resolves.toEqual({ name: "v1.0" });
    await expect(git(remote, "tag", "--list")).resolves.toBe("");
    await expect(git(worktreePath, "tag", "--list")).resolves.toBe("v1.0");
  });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rebase tags ")));
  directories.push(root);
  const worktreePath = join(root, "repository");
  await createRepository(worktreePath);
  await git(worktreePath, "config", "user.name", "Tag author");
  await git(worktreePath, "config", "user.email", "tags@example.test");
  return {
    root,
    worktreePath,
    head: await git(worktreePath, "rev-parse", "HEAD"),
  };
}

async function tagFile(directory: string, target: string) {
  const path = join(directory, "..", "signed-tag");
  await writeFile(
    path,
    [
      `object ${target}`,
      "type commit",
      "tag signed",
      "tagger Tag author <tags@example.test> 1700000000 +0000",
      "",
      "Signed release",
      "-----BEGIN PGP SIGNATURE-----",
      "",
      "iQEzBAABCAAdFiEEfake",
      "-----END PGP SIGNATURE-----",
      "",
    ].join("\n"),
  );
  return path;
}
