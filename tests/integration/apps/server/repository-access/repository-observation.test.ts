import { execFile } from "node:child_process";
import { watch } from "node:fs";
import { mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect, Exit, Scope } from "effect";
import { expect, it, vi } from "vite-plus/test";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher.ts";
import { readRepositoryRefs } from "#server/features/repository-refs/git/read-repository-refs.ts";
import { acquireRepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher.ts";
import { createRepository } from "#tests-support/git.ts";
import { waitForObservation } from "#tests-support/observation.ts";
import { openTestEnvironment } from "#tests-support/server.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, watch: vi.fn(fs.watch) };
});

const execute = promisify(execFile);

it("observes linked worktrees through one watch until the change publisher closes", async () => {
  const run = vi.fn<GitCommandRunner["run"]>();
  const environment = await openTestEnvironment({
    git: (local) => {
      run.mockImplementation(local.run);
      return { ...local, run };
    },
  });
  const main = join(environment.home, "main");
  const linked = join(environment.home, "linked");
  const git = async (...args: string[]) =>
    execute("git", ["-C", environment.home, ...args]);
  await createRepository(main);
  await git("-C", main, "worktree", "add", "-b", "linked", linked);
  const mainEntry = await environment.remember(main);
  const linkedEntry = await environment.remember(linked);
  const { access, git: runner, watcher } = environment;
  await Effect.runPromise(
    Effect.gen(function* () {
      const events = createEnvironmentEventPublisher();
      const changed = vi.fn();
      events.subscribe(changed);
      const refsScope = yield* Scope.fork(yield* Effect.scope);
      const changes = yield* acquireRepositoryChangePublisher(
        runner,
        watcher,
        events,
      ).pipe(Effect.provideService(Scope.Scope, refsScope));
      vi.mocked(watch).mockClear();
      run.mockClear();
      for (const entry of [mainEntry, linkedEntry]) {
        const repository = yield* access.repository(entry.id);
        yield* changes.watch(repository);
        yield* readRepositoryRefs(runner, repository);
      }
      const roots = vi.mocked(watch).mock.calls.flatMap((args, index) => {
        if (args[0] !== join(main, ".git")) return [];
        const result = vi.mocked(watch).mock.results[index];
        return result?.type === "return" ? [result.value] : [];
      });
      expect(roots).toHaveLength(1);
      expect(
        run.mock.calls.filter(([command]) =>
          command.arguments.includes("--git-common-dir"),
        ),
      ).toHaveLength(2);
      const closed = vi.fn();
      for (const handle of roots) handle.on("close", closed);
      yield* Effect.promise(() => git("-C", linked, "checkout", "--detach"));
      yield* Effect.promise(() =>
        waitForObservation(() =>
          expect(changed).toHaveBeenCalledWith(
            expect.any(Number),
            expect.arrayContaining([mainEntry.id, linkedEntry.id]),
            "Refs",
          ),
        ),
      );
      yield* Scope.close(refsScope, Exit.void);
      yield* Effect.promise(() =>
        waitForObservation(() => expect(closed).toHaveBeenCalledOnce()),
      );
      changed.mockClear();
      const control = createEnvironmentEventPublisher();
      const controlChanged = vi.fn();
      control.subscribe(controlChanged);
      const controlChanges = yield* acquireRepositoryChangePublisher(
        runner,
        createLocalRepositoryWatcher(),
        control,
      );
      yield* controlChanges.watch(mainEntry);
      yield* Effect.promise(() =>
        waitForObservation(
          () => expect(controlChanged).toHaveBeenCalled(),
          () => git("-C", main, "branch", "-f", "after-close"),
        ),
      );
      expect(changed).not.toHaveBeenCalled();
    }).pipe(Effect.scoped),
  );
});

it("shares canonical directory aliases and makes release idempotent", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "rebase watcher alias ")),
  );
  try {
    const directory = join(root, "repository");
    await createRepository(directory, { commits: [] });
    const common = join(directory, ".git");
    const alias = join(root, "alias");
    await symlink(
      common,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const watcher = createLocalRepositoryWatcher();
    const changed = vi.fn();
    vi.mocked(watch).mockClear();
    const first = await Effect.runPromise(watcher.watch(common, changed));
    const second = await Effect.runPromise(
      watcher.watch(alias.replaceAll("\\", "/"), changed),
    );
    try {
      expect(
        vi.mocked(watch).mock.calls.filter(([path]) => path === common),
      ).toHaveLength(1);
      first.close();
      first.close();
      await execute("git", [
        "-C",
        directory,
        "symbolic-ref",
        "HEAD",
        "refs/heads/changed",
      ]);
      await waitForObservation(() => expect(changed).toHaveBeenCalled());
    } finally {
      first.close();
      second.close();
    }
  } finally {
    await removeTemporaryDirectory(root);
  }
});
