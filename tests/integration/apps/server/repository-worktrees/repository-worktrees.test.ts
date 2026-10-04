import { access, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import {
  createWorktree,
  readWorktreeStatus,
  removeWorktree,
  unlockWorktree,
} from "#server/features/repository-worktrees/repository-worktrees.ts";
import {
  readWorktreeFolder,
  setWorktreeFolder,
} from "#server/features/repository-worktrees/worktree-folder.ts";
import { readWorktrees } from "#server/repository/repository-access.ts";
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

describe("repository worktrees", () => {
  it("creates worktrees for new and existing branches and refuses a held branch or a used folder", async () => {
    const { root, main } = await fixture({ branches: ["topic"] });
    const head = await git(main, "rev-parse", "HEAD");
    const scope = { repositoryId, worktreePath: main };
    const fresh = join(root, "main.worktrees", "feature-new");
    const topic = join(root, "main.worktrees", "topic");

    const created = await run(
      createWorktree(runner, {
        ...scope,
        path: fresh,
        start: { _tag: "NewBranch", name: "feature/new", startPoint: head },
      }),
    );
    await run(
      createWorktree(runner, {
        ...scope,
        path: topic,
        start: { _tag: "Branch", name: "topic" },
      }),
    );

    expect(created.worktreePath).toBe(fresh);
    expect(await git(fresh, "branch", "--show-current")).toBe("feature/new");
    expect(await git(topic, "branch", "--show-current")).toBe("topic");
    await expect(
      fail(
        createWorktree(runner, {
          ...scope,
          path: join(root, "again"),
          start: { _tag: "Branch", name: "topic" },
        }),
      ),
    ).resolves.toMatchObject({
      _tag: "BranchCheckedOutElsewhere",
      name: "topic",
    });
    await expect(
      fail(
        createWorktree(runner, {
          ...scope,
          path: fresh,
          start: { _tag: "NewBranch", name: "other", startPoint: head },
        }),
      ),
    ).resolves.toEqual({ _tag: "WorktreeRejected", reason: "FolderExists" });
    expect(await git(main, "branch", "--list", "other")).toBe("");
  });

  it("counts uncommitted changes and deletes them only after the user saw them, never commits on no branch", async () => {
    const { root, main } = await fixture();
    const topic = join(root, "topic");
    await git(main, "worktree", "add", "-b", "topic", topic);
    await writeFile(join(topic, "notes.md"), "draft\n");
    await writeFile(join(topic, "plan.md"), "steps\n");
    await git(topic, "add", "plan.md");
    const target = { repositoryId, worktreePath: main, target: topic };

    expect(await run(readWorktreeStatus(runner, main))).toEqual({
      worktrees: [
        { path: main, unstaged: 0, staged: 0 },
        { path: topic, unstaged: 1, staged: 1 },
      ],
    });
    await expect(
      fail(removeWorktree(runner, { ...target, changes: 0 })),
    ).resolves.toEqual({ _tag: "WorktreeChanged", changes: 2 });
    await expect(
      fail(removeWorktree(runner, { ...target, target: main, changes: 0 })),
    ).resolves.toEqual({ _tag: "WorktreeRejected", reason: "Main" });

    await run(removeWorktree(runner, { ...target, changes: 2 }));

    await expect(access(topic)).rejects.toThrow();
    expect(await git(main, "branch", "--list", "topic")).toBe("topic");
    const spike = join(root, "spike");
    await git(main, "worktree", "add", "--detach", spike);
    await git(spike, "commit", "--allow-empty", "-m", "on no branch");
    await expect(
      fail(removeWorktree(runner, { ...target, target: spike, changes: 0 })),
    ).resolves.toEqual({ _tag: "WorktreeRejected", reason: "Unsaved" });
  });

  it("keeps a locked worktree on an unplugged drive, prunes it once unlocked, and keeps the folder setting in Git", async () => {
    const { root, main } = await fixture();
    const usb = join(root, "usb");
    await git(main, "worktree", "add", "-b", "usb", usb);
    await git(main, "worktree", "lock", "--reason", "on the drive", usb);
    const target = { repositoryId, worktreePath: main, target: usb };

    await removeTemporaryDirectory(usb);

    expect(await run(readWorktreeStatus(runner, main))).toEqual({
      worktrees: [{ path: main, unstaged: 0, staged: 0 }],
    });
    await expect(
      fail(removeWorktree(runner, { ...target, changes: 0 })),
    ).resolves.toEqual({ _tag: "WorktreeRejected", reason: "Locked" });
    await run(unlockWorktree(runner, target));
    expect((await run(readWorktrees(runner, main)))[1]).toMatchObject({
      missing: true,
    });
    await run(removeWorktree(runner, { ...target, changes: 0 }));

    expect(await run(readWorktrees(runner, main))).toHaveLength(1);
    expect(await run(readWorktreeFolder(runner, main))).toMatchObject({
      folder: join(root, "main.worktrees"),
      configured: false,
    });
    await run(
      setWorktreeFolder(runner, {
        repositoryId,
        worktreePath: main,
        folder: join(root, "trees"),
      }),
    );
    expect(await run(readWorktreeFolder(runner, main))).toMatchObject({
      folder: join(root, "trees"),
      configured: true,
    });
  });
});

async function fixture(options?: { readonly branches?: readonly string[] }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rebase-wt-")));
  directories.push(root);
  const main = join(root, "main");
  await createRepository(main, options);
  return { root, main };
}

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect);
}

function fail<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(Effect.flip(effect));
}
