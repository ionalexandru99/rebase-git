import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Deferred, Effect, Fiber } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { GitCommandError } from "#server/domain/git-command.contract";
import { createRepositoryChangesService } from "#server/features/repository-changes/index";
import {
  createRepositoryOperationsService,
  createRepositoryWrites,
} from "#server/features/repository-operations/index";

const exec = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "rebase-operation-")),
  );
  directories.push(directory);
  const git = (...args: string[]) =>
    exec("git", ["-C", directory, ...args], {
      env: { ...process.env, GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" },
    });
  await git("init", "-b", "main");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.com");
  await git("config", "commit.gpgsign", "false");
  await git("config", "rerere.enabled", "false");
  await writeFile(join(directory, "file.txt"), "base\n");
  await git("add", ".");
  await git("commit", "-m", "base");
  await git("checkout", "-b", "topic");
  await writeFile(join(directory, "file.txt"), "topic\n");
  await git("commit", "-am", "topic");
  await git("checkout", "main");
  await writeFile(join(directory, "file.txt"), "main\n");
  await git("commit", "-am", "main");
  const runner = createLocalGitCommandRunner();
  const invalidated: string[] = [];
  const writes = createRepositoryWrites(runner, (event) => {
    invalidated.push(event.directory);
  });
  const catalog = {
    find: () =>
      Effect.succeed({
        id: "repo",
        path: directory,
        name: "test",
        addedAt: "",
        lastOpenedAt: "",
      }),
  };
  const service = createRepositoryOperationsService({
    git: runner,
    writes,
    catalog,
  });
  const scope = { repositoryId: "repo", worktreePath: directory };
  const read = () => Effect.runPromise(service.read(scope));
  const execute = async (action: "continue" | "skip" | "abort") =>
    Effect.runPromise(
      service.execute({ ...scope, revision: (await read()).revision, action }),
    );
  return {
    directory,
    git,
    runner,
    writes,
    invalidated,
    service,
    scope,
    read,
    execute,
    catalog,
  };
}

describe("Git operation recovery", { timeout: 30000 }, () => {
  it.each(["merge", "rebase", "cherry-pick", "revert"] as const)(
    "discovers and aborts an external %s",
    async (kind) => {
      const f = await fixture();
      expect((await f.read()).kind).toBe("idle");
      await expect(
        f.git(kind, kind === "revert" ? "HEAD~1" : "topic"),
      ).rejects.toBeDefined();
      const state = await f.read();
      expect(state.kind).toBe(kind);
      expect(state.unresolvedPaths).toEqual(["file.txt"]);
      expect(state.actions.find((a) => a.action === "continue")?.enabled).toBe(
        false,
      );
      expect(state.actions.some((a) => a.action === "skip")).toBe(
        kind !== "merge",
      );
      expect((await f.execute("abort")).operation.kind).toBe("idle");
      expect(f.invalidated).toContain(f.directory);
    },
  );

  it("continues a resolved merge and rejects stale recovery requests", async () => {
    const f = await fixture();
    await expect(f.git("merge", "topic")).rejects.toBeDefined();
    const conflicted = await f.read();
    await writeFile(join(f.directory, "file.txt"), "resolved\n");
    await expect(
      Effect.runPromise(
        f.service.execute({
          ...f.scope,
          revision: conflicted.revision,
          action: "abort",
        }),
      ),
    ).rejects.toMatchObject({ failure: { reason: "Stale" } });
    await f.git("add", ".");
    await expect(
      Effect.runPromise(
        f.service.execute({
          ...f.scope,
          revision: conflicted.revision,
          action: "continue",
        }),
      ),
    ).rejects.toMatchObject({ failure: { reason: "Stale" } });
    expect((await f.execute("continue")).operation.kind).toBe("idle");
    expect(
      (await f.git("rev-list", "--parents", "-n", "1", "HEAD")).stdout
        .trim()
        .split(" "),
    ).toHaveLength(3);
  });

  it("detects an interactive edit stop without conflicts", async () => {
    const f = await fixture();
    await f.git("checkout", "topic");
    const todo = join(f.directory, "edit-todo.sh");
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
    const changes = createRepositoryChangesService(
      f.catalog,
      f.runner,
      f.writes,
    );
    const amendment = { ...f.scope, amend: true };
    const snapshot = await Effect.runPromise(changes.read(amendment));
    await Effect.runPromise(
      changes.commit({
        ...amendment,
        revision: snapshot.revision,
        message: "amended topic",
      }),
    );
    expect((await f.execute("continue")).operation.kind).toBe("idle");
    expect((await f.git("show", "HEAD:file.txt")).stdout).toBe("amended\n");
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
      const result = await f.execute(action);
      expect(result.operation).toMatchObject({
        kind: "rebase",
        phase: "conflicts",
        progress: { current: 2, total: 2 },
        unresolvedPaths: ["second.txt"],
      });
      await f.execute("abort");
    },
  );

  it("coordinates writes but leaves reads and other worktree staging available", async () => {
    const f = await fixture();
    await expect(f.git("merge", "topic")).rejects.toBeDefined();
    await expect(
      Effect.runPromise(f.writes.run(f.directory, "checkout", Effect.void)),
    ).rejects.toMatchObject({ failure: { reason: "Incompatible" } });
    await expect(
      Effect.runPromise(f.writes.run(f.directory, "commit", Effect.void)),
    ).rejects.toMatchObject({ failure: { reason: "Incompatible" } });
    await Effect.runPromise(f.writes.run(f.directory, "stage", Effect.void));
    expect((await f.read()).kind).toBe("merge");
  });

  it.each(["rebase", "cherry-pick", "revert"] as const)(
    "skips the conflicting %s step",
    async (kind) => {
      const f = await fixture();
      await expect(
        f.git(kind, kind === "revert" ? "HEAD~1" : "topic"),
      ).rejects.toBeDefined();
      expect((await f.execute("skip")).operation.kind).toBe("idle");
    },
  );

  it.each(["continue", "skip", "abort"] as const)(
    "discovers and recovers git am using %s",
    async (action) => {
      const f = await fixture();
      const patch = join(f.directory, "mail.patch");
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
      expect((await f.execute(action)).operation.kind).toBe("idle");
    },
  );

  it.each(["rebase", "cherry-pick", "revert"] as const)(
    "stages a resolved %s conflict through the changes service before continuing",
    async (kind) => {
      const f = await fixture();
      await expect(
        f.git(kind, kind === "revert" ? "HEAD~1" : "topic"),
      ).rejects.toBeDefined();
      await writeFile(join(f.directory, "file.txt"), "resolved\n");
      const changes = createRepositoryChangesService(
        f.catalog,
        f.runner,
        f.writes,
      );
      const scope = { ...f.scope, amend: false };
      const snapshot = await Effect.runPromise(changes.read(scope));
      await Effect.runPromise(
        changes.mutate({
          ...scope,
          revision: snapshot.revision,
          action: "stage",
          section: "unstaged",
          selection: { _tag: "Files", paths: ["file.txt"] },
        }),
      );
      expect((await f.execute("continue")).operation.kind).toBe("idle");
      expect((await f.git("show", "HEAD:file.txt")).stdout).toBe("resolved\n");
    },
  );

  it("rediscovers an operation in a linked worktree while the main worktree stays idle", async () => {
    const f = await fixture();
    const linked = `${f.directory}-linked`;
    directories.push(linked);
    await f.git("worktree", "add", linked, "topic");
    await expect(
      exec("git", ["-C", linked, "merge", "main"]),
    ).rejects.toBeDefined();
    const linkedScope = { ...f.scope, worktreePath: await realpath(linked) };
    expect((await f.read()).kind).toBe("idle");
    const restarted = createRepositoryOperationsService({
      git: f.runner,
      catalog: f.catalog,
      writes: createRepositoryWrites(f.runner),
    });
    expect(await Effect.runPromise(restarted.read(linkedScope))).toMatchObject({
      kind: "merge",
      unresolvedPaths: ["file.txt"],
    });
    await exec("git", ["-C", linked, "merge", "--abort"]);
    expect((await Effect.runPromise(restarted.read(linkedScope))).kind).toBe(
      "idle",
    );
  });

  it("reports real Git locks, hook failures and uncertain process results without losing invalidation", async () => {
    const f = await fixture();
    await expect(f.git("merge", "topic")).rejects.toBeDefined();
    await writeFile(join(f.directory, "file.txt"), "resolved\n");
    await f.git("add", ".");
    const lock = join(f.directory, ".git", "index.lock");
    await writeFile(lock, "other process");
    expect((await f.read()).lock).toBe("index.lock");
    await expect(f.execute("continue")).rejects.toMatchObject({
      failure: { reason: "Locked" },
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
      failure: {
        reason: "HookFailed",
        invalidation: { status: true, refs: true, history: true },
      },
    });
    expect((await f.read()).kind).toBe("merge");
    await rm(hook);
    const uncertain = createRepositoryOperationsService({
      catalog: f.catalog,
      writes: f.writes,
      git: {
        run: (command) =>
          command.arguments.includes("--continue")
            ? f.runner
                .run(command)
                .pipe(
                  Effect.andThen(
                    Effect.fail(new GitCommandError({ reason: "Timeout" })),
                  ),
                )
            : f.runner.run(command),
      },
    });
    await expect(
      Effect.runPromise(
        uncertain.execute({
          ...f.scope,
          revision: (await f.read()).revision,
          action: "continue",
        }),
      ),
    ).rejects.toMatchObject({
      failure: {
        reason: "Uncertain",
        invalidation: { status: true, refs: true, history: true },
      },
    });
    expect((await f.read()).kind).toBe("idle");
    expect(f.invalidated.length).toBeGreaterThanOrEqual(2);
  });

  it("serializes shared-ref writers across worktrees without holding unrelated reads or index writes", async () => {
    const f = await fixture();
    const linked = `${f.directory}-linked`;
    directories.push(linked);
    await f.git("worktree", "add", linked, "topic");
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const order: string[] = [];
          const first = yield* f.writes
            .run(
              f.directory,
              "fetch",
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(
                  Effect.sync(() => {
                    order.push("first");
                  }),
                ),
              ),
            )
            .pipe(Effect.forkScoped);
          yield* Deferred.await(entered);
          const contendedFetch = yield* f.writes
            .run(linked, "fetch", Effect.die("Fetch must not start"))
            .pipe(Effect.flip, Effect.timeout("1 second"));
          expect(contendedFetch.failure.reason).toBe("Locked");
          const second = yield* f.writes
            .run(
              linked,
              "commit",
              Effect.sync(() => {
                order.push("second");
              }),
            )
            .pipe(Effect.forkScoped);
          yield* f.writes.run(
            linked,
            "stage",
            Effect.sync(() => {
              order.push("stage");
            }),
          );
          yield* f.service.read(f.scope);
          expect(order).toEqual(["stage"]);
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(first);
          yield* Fiber.join(second);
          expect(order).toEqual(["stage", "first", "second"]);
        }),
      ),
    );
  });
});
