import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { ChangeSection } from "#contracts/repository-changes/repository-changes.contract.ts";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { readRepositoryChanges } from "#server/features/repository-changes/repository-changes.ts";
import { createGitLfs } from "#server/features/repository-lfs/git-lfs.ts";
import {
  applyStash,
  dropStash,
  readStashContents,
} from "#server/features/repository-stashes/repository-stashes.ts";
import { saveStash } from "#server/features/repository-stashes/save-stash.ts";
import { listStashes } from "#server/features/repository-stashes/stash-entries.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const runner = createLocalGitCommandRunner();
const directories: string[] = [];
const lines = (...values: readonly string[]) => `${values.join("\n")}\n`;

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => removeTemporaryDirectory(path)),
  );
});

describe("repository stashes", () => {
  it("lists named, automatic, unnamed and Git autostash stashes with their untracked files", async () => {
    const worktreePath = await fixture();
    await edit(worktreePath, "a.txt", lines("one", "two changed", "three"));
    await git(worktreePath, "add", "a.txt");
    await git(worktreePath, "stash", "push", "-m", "Staged work");
    await edit(worktreePath, "notes.md", "notes\n");
    await git(
      worktreePath,
      "stash",
      "push",
      "--include-untracked",
      "-m",
      "rebase-auto-stash:3f1c2a9e-1b2c-4d5e-8f90-123456789abc before checking out topic",
    );
    await edit(worktreePath, "b.txt", "b changed\n");
    await git(worktreePath, "stash", "push");
    await edit(worktreePath, "b.txt", "b kept by a pull\n");
    const kept = await git(worktreePath, "stash", "create", "autostash");
    await git(worktreePath, "stash", "store", "-m", "autostash", kept.trim());

    const { stashes } = await run(listStashes(runner, worktreePath));

    expect(stashes).toMatchObject([
      { name: "Changes on main", named: true, auto: false, branch: "main" },
      {
        name: "WIP on main",
        named: false,
        auto: false,
        branch: "main",
        staged: false,
      },
      {
        name: "Before checking out topic",
        auto: true,
        branch: "main",
        staged: false,
      },
      { name: "Staged work", named: true, auto: false, staged: true },
    ]);
    const contents = await run(
      readStashContents(runner, {
        repositoryId,
        worktreePath,
        oid: stashes[2]?.oid ?? "",
      }),
    );
    expect(contents.files).toEqual([
      {
        path: "notes.md",
        previousPath: null,
        status: "A",
        lines: { added: 1, removed: 0 },
        lfs: false,
        untracked: true,
      },
    ]);
  });

  it("applies with the staged state, moves the stash to the top, and pops", async () => {
    const worktreePath = await fixture();
    await edit(worktreePath, "a.txt", lines("one", "two staged", "three"));
    await git(worktreePath, "add", "a.txt");
    await git(worktreePath, "stash", "push", "-m", "Staged");
    await edit(worktreePath, "b.txt", "b changed\n");
    await git(worktreePath, "stash", "push", "-m", "Newer");
    const staged = await stashOid(worktreePath, "Staged");

    await expect(
      run(
        applyStash(runner, {
          repositoryId,
          worktreePath,
          oid: staged,
          restoreIndex: true,
          drop: false,
        }),
      ),
    ).resolves.toEqual({ conflicts: 0 });

    await expect(
      git(worktreePath, "diff", "--cached", "--name-only"),
    ).resolves.toBe("a.txt");
    expect((await names(worktreePath))[0]).toBe("Staged");
    await git(worktreePath, "reset", "--hard", "--quiet");
    await run(
      applyStash(runner, {
        repositoryId,
        worktreePath,
        oid: staged,
        restoreIndex: false,
        drop: true,
      }),
    );
    await expect(names(worktreePath)).resolves.toEqual(["Newer"]);
    await expect(
      git(worktreePath, "diff", "--cached", "--name-only"),
    ).resolves.toBe("");
  });

  it("keeps a stash whose pop conflicts and reports the conflicted files", async () => {
    const worktreePath = await fixture();
    await edit(worktreePath, "a.txt", lines("one", "two stashed", "three"));
    await git(worktreePath, "stash", "push", "-m", "Conflicting");
    await edit(worktreePath, "a.txt", lines("one", "two committed", "three"));
    await git(worktreePath, "commit", "-qam", "change two");
    const oid = await stashOid(worktreePath, "Conflicting");

    await expect(
      run(
        applyStash(runner, {
          repositoryId,
          worktreePath,
          oid,
          restoreIndex: false,
          drop: true,
        }),
      ),
    ).resolves.toEqual({ conflicts: 1 });
    await expect(names(worktreePath)).resolves.toEqual(["Conflicting"]);
  });

  it("drops a stash by identity after the list moved", async () => {
    const worktreePath = await fixture();
    await edit(worktreePath, "a.txt", "first\n");
    await git(worktreePath, "stash", "push", "-m", "First");
    const first = await stashOid(worktreePath, "First");
    await edit(worktreePath, "b.txt", "second\n");
    await git(worktreePath, "stash", "push", "-m", "Second");

    await run(dropStash(runner, { repositoryId, worktreePath, oid: first }));

    await expect(names(worktreePath)).resolves.toEqual(["Second"]);
    await expect(
      run(dropStash(runner, { repositoryId, worktreePath, oid: first })),
    ).rejects.toMatchObject({ _tag: "StashMissing" });
  });

  it("stashes only the unstaged part of a file and keeps its staged part", async () => {
    const worktreePath = await fixture();
    await edit(worktreePath, "a.txt", lines("one staged", "two", "three"));
    await git(worktreePath, "add", "a.txt");
    await edit(
      worktreePath,
      "a.txt",
      lines("one staged", "two", "three unstaged"),
    );

    await save(worktreePath, "unstaged", ["a.txt"], { name: "Tail" });

    await expect(readFile(join(worktreePath, "a.txt"), "utf8")).resolves.toBe(
      lines("one staged", "two", "three"),
    );
    await expect(
      git(worktreePath, "diff", "--cached", "--name-only"),
    ).resolves.toBe("a.txt");
    await expect(
      git(worktreePath, "stash", "list", "--format=%gs"),
    ).resolves.toBe("On main: Tail");
    await git(worktreePath, "reset", "--hard", "--quiet");
    await git(worktreePath, "stash", "pop", "--quiet");
    await expect(readFile(join(worktreePath, "a.txt"), "utf8")).resolves.toBe(
      lines("one", "two", "three unstaged"),
    );
  });

  it("stashes staged changes and untracked files that come back on apply", async () => {
    const worktreePath = await fixture();
    await edit(worktreePath, "b.txt", "b staged\n");
    await git(worktreePath, "add", "b.txt");
    await edit(worktreePath, "notes.md", "notes\n");

    await save(worktreePath, "staged", ["b.txt"]);
    await save(worktreePath, "unstaged", ["notes.md"], {
      into: await stashOid(worktreePath, "WIP on main"),
    });

    await expect(git(worktreePath, "status", "--porcelain")).resolves.toBe("");
    await expect(names(worktreePath)).resolves.toEqual(["WIP on main"]);
    await git(worktreePath, "stash", "apply", "--index", "--quiet");
    await expect(git(worktreePath, "status", "--porcelain")).resolves.toBe(
      ["M  b.txt", "?? notes.md"].join("\n"),
    );
  });

  it("refuses changes that overlap the target stash and leaves everything in place", async () => {
    const worktreePath = await fixture();
    await edit(worktreePath, "a.txt", lines("one", "two stashed", "three"));
    await git(worktreePath, "stash", "push", "-m", "Target");
    const target = await stashOid(worktreePath, "Target");
    await edit(worktreePath, "a.txt", lines("one", "two again", "three"));

    await expect(
      save(worktreePath, "unstaged", ["a.txt"], { into: target }),
    ).rejects.toMatchObject({
      _tag: "StashRejected",
      reason: "DoesNotFit",
    });
    await expect(names(worktreePath)).resolves.toEqual(["Target"]);
    await expect(git(worktreePath, "diff", "--name-only")).resolves.toBe(
      "a.txt",
    );
  });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rebase stashes ")));
  directories.push(root);
  const worktreePath = join(root, "repository");
  await createRepository(worktreePath, { commits: [] });
  await git(worktreePath, "config", "user.name", "Stash author");
  await git(worktreePath, "config", "user.email", "stash@example.test");
  await edit(worktreePath, "a.txt", lines("one", "two", "three"));
  await edit(worktreePath, "b.txt", "b\n");
  await git(worktreePath, "add", ".");
  await git(worktreePath, "commit", "-qm", "initial");
  return worktreePath;
}

function edit(worktreePath: string, path: string, content: string) {
  return writeFile(join(worktreePath, path), content);
}

async function save(
  worktreePath: string,
  section: ChangeSection,
  paths: readonly string[],
  {
    into = null,
    name,
  }: { readonly into?: string | null; readonly name?: string } = {},
) {
  const { revision } = await run(
    readRepositoryChanges({ repositoryId, worktreePath, amend: false }, runner),
  );
  return run(
    saveStash(runner, createGitLfs(runner), {
      repositoryId,
      worktreePath,
      revision,
      into,
      section,
      paths,
      ...(name === undefined ? {} : { name }),
    }),
  );
}

async function names(worktreePath: string) {
  const { stashes } = await run(listStashes(runner, worktreePath));
  return stashes.map((stash) => stash.name);
}

async function stashOid(worktreePath: string, name: string) {
  const { stashes } = await run(listStashes(runner, worktreePath));
  return stashes.find((stash) => stash.name === name)?.oid ?? "";
}

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect);
}
