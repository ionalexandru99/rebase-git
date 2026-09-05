import { execFile } from "node:child_process";
import { watch } from "node:fs";
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { expect, it, vi } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryCatalogAccess } from "#server/domain/repository-catalog.contract";
import { RepositoryFreshnessState } from "#server/domain/repository-freshness.contract";
import { RepositoryWatching } from "#server/domain/repository-watcher.contract";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import { createRepositoryCatalog } from "#server/features/repository-catalog/repository-catalog";
import { repositoryFreshnessLayer } from "#server/features/repository-history/freshness/repository-freshness";
import { acquireRepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher";
import { createRepositoryRefsService } from "#server/features/repository-refs/repository-refs";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, watch: vi.fn(fs.watch) };
});

const execute = promisify(execFile);

for (const firstRelease of ["refs", "freshness"] as const)
  it(`shares linked-worktree observation until the last owner leaves, releasing ${firstRelease} first`, async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "rebase observation ")),
    );
    const main = join(root, "main");
    const linked = join(root, "linked");
    const git = async (...args: string[]) =>
      execute("git", ["-C", root, ...args]);
    try {
      await git("init", "-b", "main", main);
      await git(
        "-C",
        main,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "initial",
      );
      await git("-C", main, "worktree", "add", "-b", "linked", linked);
      await Effect.runPromise(
        Effect.gen(function* () {
          const context = yield* acquireEnvironmentContext(
            environmentPaths(join(root, "state")),
          );
          const catalog = createRepositoryCatalog(context);
          const mainEntry = yield* catalog.remember(main);
          const linkedEntry = yield* catalog.remember(linked);
          const local = createLocalGitCommandRunner();
          const run = vi.fn(local.run);
          const runner = { run };
          const watcher = createLocalRepositoryWatcher();
          const events = createEnvironmentEventPublisher();
          const changed = vi.fn();
          events.subscribe(changed);
          const refsScope = yield* Scope.fork(yield* Effect.scope);
          const changes = yield* acquireRepositoryChangePublisher(
            runner,
            watcher,
            events,
          ).pipe(Effect.provideService(Scope.Scope, refsScope));
          const refs = createRepositoryRefsService({
            catalog,
            changes,
            git: runner,
          });
          vi.mocked(watch).mockClear();
          yield* refs.read(mainEntry.id);
          yield* refs.read(linkedEntry.id);
          const services = yield* Layer.build(
            repositoryFreshnessLayer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(GitCommands, runner),
                  Layer.succeed(RepositoryCatalogAccess, catalog),
                  Layer.succeed(RepositoryWatching, watcher),
                ),
              ),
            ),
          );
          const freshness = Context.get(services, RepositoryFreshnessState);
          const fresh = vi.fn();
          const unsubscribe = yield* freshness.subscribe(linkedEntry.id, fresh);
          expect(run).toHaveBeenCalledTimes(12);
          const roots = vi
            .mocked(watch)
            .mock.calls.flatMap((args, index) =>
              args[0] === join(main, ".git")
                ? [vi.mocked(watch).mock.results[index]?.value]
                : [],
            );
          expect(roots).toHaveLength(1);
          expect(
            run.mock.calls.filter(([command]) =>
              command.arguments.includes("--git-common-dir"),
            ),
          ).toHaveLength(3);
          const closed = vi.fn();
          for (const handle of roots) handle.on("close", closed);
          yield* Effect.promise(() =>
            git("-C", linked, "checkout", "--detach"),
          );
          yield* Effect.promise(() =>
            vi.waitFor(() => {
              expect(changed).toHaveBeenCalledWith(
                expect.any(Number),
                expect.arrayContaining([mainEntry.id, linkedEntry.id]),
              );
              expect(fresh.mock.calls.at(-1)?.[0].revision).toBeGreaterThan(0);
            }),
          );
          const releaseRefs = Scope.close(refsScope, Exit.void);
          yield* firstRelease === "refs" ? releaseRefs : unsubscribe;
          changed.mockClear();
          fresh.mockClear();
          yield* Effect.promise(() =>
            git("-C", main, "branch", "still-observed"),
          );
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(
                firstRelease === "refs" ? fresh : changed,
              ).toHaveBeenCalled(),
            ),
          );
          expect(closed).not.toHaveBeenCalled();
          yield* firstRelease === "refs" ? unsubscribe : releaseRefs;
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(closed).toHaveBeenCalledOnce()),
          );
          changed.mockClear();
          fresh.mockClear();
          yield* Effect.promise(() => git("-C", main, "branch", "after-close"));
          yield* Effect.sleep(200);
          expect(changed).not.toHaveBeenCalled();
          expect(fresh).not.toHaveBeenCalled();
        }).pipe(Effect.scoped),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

it("shares canonical directory aliases and makes release idempotent", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "rebase watcher alias ")),
  );
  try {
    const directory = join(root, "repository");
    await execute("git", ["init", directory]);
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
      await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    } finally {
      first.close();
      second.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
