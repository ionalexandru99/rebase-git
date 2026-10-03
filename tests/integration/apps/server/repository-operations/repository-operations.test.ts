import { execFile } from "node:child_process";
import { chmod, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  type OperationAction,
  RepositoryOperationsApi,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { createDivergedRepository, startConflict } from "#tests-support/git.ts";
import { interruptGit, openTestEnvironment } from "#tests-support/server.ts";

const exec = promisify(execFile);
afterEach(() => {
  vi.unstubAllEnvs();
});

async function fixture() {
  let wrap: ((runner: GitCommandRunner) => GitCommandRunner) | undefined;
  const environment = await openTestEnvironment({
    git: (runner) => ({
      ...runner,
      run: (command) => (wrap?.(runner) ?? runner).run(command),
    }),
  });
  const { directory, git } = await createDivergedRepository(environment.home);
  const repositoryId = (await environment.remember(directory)).id;
  const service = environment.routes(RepositoryOperationsApi);
  const scope = { repositoryId, worktreePath: directory };
  const read = () => Effect.runPromise(service.read(scope));
  const execute = async (action: OperationAction) =>
    Effect.runPromise(
      service.execute({ ...scope, revision: (await read()).revision, action }),
    );
  return {
    directory,
    git,
    service,
    scope,
    read,
    execute,
    interruptGit: (command: string, applied: boolean) => {
      wrap = interruptGit(command, applied);
    },
  };
}

describe("Git operation recovery", () => {
  it.each(["merge", "rebase", "cherry-pick", "revert"] as const)(
    "discovers and aborts an external %s",
    async (kind) => {
      const f = await fixture();
      expect((await f.read()).kind).toBe("idle");
      await startConflict(f.git, kind);
      const state = await f.read();
      expect(state.kind).toBe(kind);
      expect(state.unresolvedPaths).toEqual(["file.txt"]);
      expect(state.actions.find((a) => a.action === "continue")?.enabled).toBe(
        false,
      );
      expect(state.actions.some((a) => a.action === "skip")).toBe(
        kind !== "merge",
      );
      expect((await f.execute("abort")).kind).toBe("idle");
    },
  );

  it("continues a resolved merge without the inherited editor and rejects stale requests", async () => {
    vi.stubEnv("GIT_EDITOR", "false");
    const f = await fixture();
    await startConflict(f.git, "merge");
    const conflicted = await f.read();
    await writeFile(join(f.directory, "file.txt"), "resolved\n");
    const stale = (action: OperationAction) =>
      Effect.runPromise(
        f.service.execute({
          ...f.scope,
          revision: conflicted.revision,
          action,
        }),
      );
    await expect(stale("abort")).rejects.toMatchObject({ reason: "Stale" });
    await f.git("add", ".");
    await expect(stale("continue")).rejects.toMatchObject({ reason: "Stale" });
    expect((await f.execute("continue")).kind).toBe("idle");
    expect(
      (await f.git("rev-list", "--parents", "-n", "1", "HEAD")).stdout
        .trim()
        .split(" "),
    ).toHaveLength(3);
  });

  it("detects an interactive edit stop without conflicts", async () => {
    const f = await fixture();
    await f.git("checkout", "topic");
    const todo = join(f.directory, ".git", "edit-todo.sh");
    await writeFile(
      todo,
      '#!/bin/sh\nprintf "edit %s topic\\n" "$(git rev-parse HEAD)" > "$1"\n',
      { mode: 0o755 },
    );
    await exec("git", ["-C", f.directory, "rebase", "-i", "HEAD~1"], {
      env: {
        ...process.env,
        GIT_SEQUENCE_EDITOR: `sh '${todo}'`,
        GIT_EDITOR: "true",
      },
    });
    const state = await f.read();
    expect(state).toMatchObject({
      kind: "rebase",
      phase: "edit",
      unresolvedPaths: [],
      progress: { current: 1, total: 1 },
    });
    expect(state.actions.find((a) => a.action === "continue")?.enabled).toBe(
      true,
    );
    expect(state.actions.some((a) => a.action === "skip")).toBe(false);
    await writeFile(join(f.directory, "file.txt"), "amended\n");
    await f.git("add", "file.txt");
    expect(
      (await f.read()).actions.find((a) => a.action === "continue")?.enabled,
    ).toBe(false);
  });

  it.each(["continue", "skip"] as const)(
    "returns the next conflict after rebase %s advances a step",
    async (action) => {
      const f = await fixture();
      await writeFile(join(f.directory, "second.txt"), "main\n");
      await f.git("add", "second.txt");
      await f.git("commit", "-m", "main second file");
      await f.git("switch", "topic");
      await writeFile(join(f.directory, "second.txt"), "topic\n");
      await f.git("add", "second.txt");
      await f.git("commit", "-m", "topic second file");
      await expect(f.git("rebase", "main")).rejects.toBeDefined();
      expect((await f.read()).progress).toEqual({ current: 1, total: 2 });
      if (action === "continue") {
        await writeFile(join(f.directory, "file.txt"), "resolved\n");
        await f.git("add", "file.txt");
      }
      expect(await f.execute(action)).toMatchObject({
        kind: "rebase",
        phase: "conflicts",
        progress: { current: 2, total: 2 },
        unresolvedPaths: ["second.txt"],
      });
      await f.execute("abort");
    },
  );

  it.each(["rebase", "cherry-pick", "revert"] as const)(
    "skips the conflicting %s step",
    async (kind) => {
      const f = await fixture();
      await startConflict(f.git, kind);
      expect((await f.execute("skip")).kind).toBe("idle");
    },
  );

  it.each(["continue", "skip", "abort"] as const)(
    "discovers and recovers git am using %s",
    async (action) => {
      const f = await fixture();
      const patch = join(f.directory, ".git", "mail.patch");
      await writeFile(
        patch,
        (await f.git("format-patch", "-1", "topic", "--stdout")).stdout,
      );
      await expect(f.git("am", "--3way", patch)).rejects.toBeDefined();
      expect(await f.read()).toMatchObject({
        kind: "am",
        progress: { current: 1, total: 1 },
        unresolvedPaths: ["file.txt"],
      });
      if (action === "continue") {
        await writeFile(join(f.directory, "file.txt"), "resolved\n");
        await f.git("add", "file.txt");
      }
      expect((await f.execute(action)).kind).toBe("idle");
    },
  );

  it("rediscovers an operation in a linked worktree while the main worktree stays idle", async () => {
    const f = await fixture();
    const linked = `${f.directory}-linked`;
    await f.git("worktree", "add", linked, "topic");
    await expect(
      exec("git", ["-C", linked, "merge", "main"]),
    ).rejects.toBeDefined();
    const linkedScope = { ...f.scope, worktreePath: await realpath(linked) };
    expect((await f.read()).kind).toBe("idle");
    expect(await Effect.runPromise(f.service.read(linkedScope))).toMatchObject({
      kind: "merge",
      unresolvedPaths: ["file.txt"],
    });
    await exec("git", ["-C", linked, "merge", "--abort"]);
    expect((await Effect.runPromise(f.service.read(linkedScope))).kind).toBe(
      "idle",
    );
  });

  it("reports real Git locks and hook failures", async () => {
    const f = await fixture();
    await startConflict(f.git, "merge");
    await writeFile(join(f.directory, "file.txt"), "resolved\n");
    await f.git("add", ".");
    const lock = join(f.directory, ".git", "index.lock");
    await writeFile(lock, "other process");
    expect((await f.read()).lock).toBe("index.lock");
    await expect(f.execute("continue")).rejects.toMatchObject({
      _tag: "RepositoryRejected",
      reason: "Busy",
    });
    expect(await readFile(lock, "utf8")).toBe("other process");
    await rm(lock);
    const hook = join(f.directory, ".git", "hooks", "pre-commit");
    await writeFile(
      hook,
      '#!/bin/sh\necho "pre-commit: rejected" >&2\nexit 1\n',
    );
    await chmod(hook, 0o755);
    await expect(f.execute("continue")).rejects.toMatchObject({
      reason: "HookFailed",
    });
    expect((await f.read()).kind).toBe("merge");
  });

  it("reports a continue Git finished before it stopped as done and one it never ran as a Git failure", async () => {
    const f = await fixture();
    await startConflict(f.git, "merge");
    await writeFile(join(f.directory, "file.txt"), "resolved\n");
    await f.git("add", ".");
    f.interruptGit("merge --continue", false);
    await expect(f.execute("continue")).rejects.toMatchObject({
      _tag: "RepositoryRejected",
      reason: "GitFailed",
    });
    expect((await f.read()).kind).toBe("merge");

    f.interruptGit("merge --continue", true);
    expect((await f.execute("continue")).kind).toBe("idle");
  });
});
