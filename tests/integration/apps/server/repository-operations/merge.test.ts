import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  type MergeMode,
  RepositoryOperationsApi,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { createMergeRepository } from "#tests-support/git.ts";
import { interruptGit, openTestEnvironment } from "#tests-support/server.ts";

async function fixture(wrap?: (runner: GitCommandRunner) => GitCommandRunner) {
  const environment = await openTestEnvironment({ git: wrap });
  const { directory, git } = await createMergeRepository(environment.home);
  const repositoryId = (await environment.remember(directory)).id;
  const service = environment.routes(RepositoryOperationsApi);
  const scope = { repositoryId, worktreePath: directory };
  const revParse = async (rev: string) =>
    (await git("rev-parse", rev)).stdout.trim();
  const merge = async (
    ref: string,
    mode: MergeMode,
    overrides: { expectedHead?: string; commit?: string } = {},
  ) =>
    Effect.runPromise(
      service.start({
        ...scope,
        expectedHead: overrides.expectedHead ?? (await revParse("HEAD")),
        operation: {
          _tag: "Merge",
          source: { ref, commit: overrides.commit ?? (await revParse(ref)) },
          mode,
        },
      }),
    );
  const abort = async () =>
    Effect.runPromise(
      service.execute({
        ...scope,
        revision: (await Effect.runPromise(service.read(scope))).revision,
        action: "abort",
      }),
    );
  const parents = async () =>
    (await git("rev-list", "--parents", "-n", "1", "HEAD")).stdout
      .trim()
      .split(" ")
      .slice(1);
  const status = async () => (await git("status", "--porcelain")).stdout.trim();
  return { directory, git, merge, abort, parents, revParse, status };
}

describe("Starting a merge", () => {
  it("fast-forwards when it can, refuses fast-forward only on diverged branches and merges them with two parents", async () => {
    const f = await fixture();
    const ahead = await f.revParse("ahead");
    await expect(f.merge("ahead", "merge")).resolves.toMatchObject({
      outcome: "FastForwarded",
    });
    expect(await f.revParse("HEAD")).toBe(ahead);

    await expect(f.merge("clean", "ff-only")).rejects.toMatchObject({
      reason: "NotFastForward",
    });
    expect(await f.revParse("HEAD")).toBe(ahead);

    await expect(f.merge("clean", "merge")).resolves.toMatchObject({
      outcome: "Committed",
      operation: { kind: "idle" },
    });
    expect(await f.parents()).toEqual([ahead, await f.revParse("clean")]);
    expect((await f.git("log", "-1", "--format=%s")).stdout.trim()).toBe(
      "Merge branch 'clean'",
    );
  });

  it("creates a merge commit even when main could fast-forward and only stages a squash", async () => {
    const f = await fixture();
    const main = await f.revParse("HEAD");
    await expect(f.merge("ahead", "no-ff")).resolves.toMatchObject({
      outcome: "Committed",
    });
    expect(await f.parents()).toEqual([main, await f.revParse("ahead")]);

    const merged = await f.revParse("HEAD");
    await expect(f.merge("clean", "squash")).resolves.toMatchObject({
      outcome: "Staged",
      operation: { kind: "idle" },
    });
    expect(await f.revParse("HEAD")).toBe(merged);
    expect(await f.status()).toBe("A  new.txt");
  });

  it("answers up to date and refuses unrelated histories and moved targets without touching the worktree", async () => {
    const f = await fixture();
    const main = await f.revParse("HEAD");
    await expect(f.merge("main~1", "merge")).resolves.toMatchObject({
      outcome: "UpToDate",
    });
    await expect(f.merge("lonely", "merge")).rejects.toMatchObject({
      reason: "Unrelated",
    });
    await expect(
      f.merge("clean", "merge", { expectedHead: await f.revParse("clean") }),
    ).rejects.toMatchObject({ reason: "Stale" });
    await expect(
      f.merge("clean", "merge", { commit: await f.revParse("ahead") }),
    ).rejects.toMatchObject({ reason: "Stale" });
    expect(await f.revParse("HEAD")).toBe(main);
    expect(await f.status()).toBe("");
  });

  it.each(["merge", "squash"] as const)(
    "stops a conflicting %s in the operation lifecycle and aborts back to the start",
    async (mode) => {
      const f = await fixture();
      const main = await f.revParse("HEAD");
      await expect(f.merge("topic", mode)).resolves.toMatchObject({
        outcome: "Stopped",
        operation: {
          kind: mode,
          phase: "conflicts",
          unresolvedPaths: ["file.txt"],
          commit: await f.revParse("topic"),
          actions:
            mode === "merge"
              ? [
                  expect.objectContaining({ action: "continue" }),
                  expect.objectContaining({ action: "abort", enabled: true }),
                ]
              : [expect.objectContaining({ action: "abort", enabled: true })],
        },
      });
      expect((await f.abort()).kind).toBe("idle");
      expect(await f.revParse("HEAD")).toBe(main);
      expect(await f.status()).toBe("");
      await expect(
        access(join(f.directory, ".git", "SQUASH_MSG")),
      ).rejects.toThrow();
    },
  );

  it("refuses to overwrite local edits and keeps them", async () => {
    const f = await fixture();
    await writeFile(join(f.directory, "file.txt"), "local\n");
    await expect(f.merge("topic", "merge")).rejects.toMatchObject({
      reason: "WouldOverwrite",
      paths: ["file.txt"],
    });
    expect(await f.status()).toBe("M file.txt");
  });

  it.each([
    ["merge", "Committed"],
    ["squash", "Staged"],
  ] as const)(
    "reports a %s Git applied before it stopped as done and one it never ran as a Git failure",
    async (mode, outcome) => {
      const applied = await fixture(interruptGit("merge", true));
      await expect(applied.merge("clean", mode)).resolves.toMatchObject({
        outcome,
      });

      const untouched = await fixture(interruptGit("merge", false));
      const main = await untouched.revParse("HEAD");
      await expect(untouched.merge("clean", mode)).rejects.toMatchObject({
        _tag: "RepositoryRejected",
        reason: "GitFailed",
      });
      expect(await untouched.revParse("HEAD")).toBe(main);
      expect(await untouched.status()).toBe("");
    },
  );

  it("runs the repository's own merge hooks", async () => {
    const f = await fixture();
    await writeFile(
      join(f.directory, ".git", "hooks", "pre-merge-commit"),
      "#!/bin/sh\necho 'merge blocked by policy' >&2\nexit 1\n",
      { mode: 0o755 },
    );
    await expect(f.merge("clean", "merge")).rejects.toMatchObject({
      reason: "HookFailed",
      detail: expect.stringContaining("merge blocked by policy"),
    });
  });
});
