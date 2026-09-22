import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Deferred, Effect, Fiber, Option } from "effect";
import { afterEach, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { createRepositoryAccess } from "#server/features/repository-access/index";
import { createRepositoryChangesService } from "#server/features/repository-changes/index";
import { createRepositoryCoordination } from "#server/features/repository-coordination/index";
import { createRepositoryRefsService } from "#server/features/repository-refs/repository-refs";

const directories: string[] = [];
const execute = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it.each([false, true])(
  "serializes commit and checkout across features, linked worktree: %s",
  async (linked) => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "rebase-coordination-")),
    );
    directories.push(root);
    const directory = join(root, "repository");
    const git = (...args: string[]) =>
      execute("git", ["-C", directory, ...args]);
    await execute("git", ["init", "-b", "main", directory]);
    await git("config", "user.name", "Test");
    await git("config", "user.email", "test@example.test");
    await git("config", "commit.gpgsign", "false");
    await writeFile(join(directory, "file.txt"), "initial\n");
    await git("add", ".");
    await git("commit", "-m", "Initial");
    await git("branch", "next");
    const checkoutDirectory = linked ? join(root, "linked") : directory;
    if (linked) {
      await git("worktree", "add", "-b", "topic", checkoutDirectory);
    }
    await writeFile(join(directory, "file.txt"), "committed\n");
    await git("add", ".");

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const commitEntered = yield* Deferred.make<void>();
          const releaseCommit = yield* Deferred.make<void>();
          const checkoutEntered = yield* Deferred.make<void>();
          const checkoutRequested = yield* Deferred.make<void>();
          const events: string[] = [];
          const local = createLocalGitCommandRunner();
          const runner: GitCommandRunner = {
            run: (command) =>
              Effect.gen(function* () {
                if (command.arguments.includes("commit")) {
                  events.push("commit-start");
                  yield* Deferred.succeed(commitEntered, undefined);
                  yield* Deferred.await(releaseCommit);
                  const result = yield* local.run(command);
                  events.push("commit-end");
                  return result;
                }
                if (command.arguments[0] === "checkout") {
                  events.push("checkout");
                  yield* Deferred.succeed(checkoutEntered, undefined);
                }
                return yield* local.run(command);
              }),
          };
          const coordination = createRepositoryCoordination(runner);
          const repositoryId = randomUUID();
          const catalog = {
            find: () =>
              Effect.succeed({
                id: repositoryId,
                path: directory,
                name: "test",
                addedAt: "",
                lastOpenedAt: "",
              }),
          };
          const changes = createRepositoryChangesService(
            createRepositoryAccess(catalog, runner),
            runner,
            coordination,
          );
          const refs = createRepositoryRefsService({
            catalog,
            git: runner,
            changes: { watch: () => Effect.void },
            coordination: {
              run: (path, scope, operation) =>
                Deferred.succeed(checkoutRequested, undefined).pipe(
                  Effect.andThen(coordination.run(path, scope, operation)),
                ),
            },
          });
          const scope = { repositoryId, worktreePath: directory, amend: false };
          const snapshot = yield* changes.read(scope);
          const committing = yield* changes
            .commit({
              ...scope,
              revision: snapshot.revision,
              message: "Coordinated",
            })
            .pipe(Effect.forkScoped);
          yield* Deferred.await(commitEntered);
          const checkingOut = yield* refs
            .checkout({
              repositoryId,
              worktreePath: checkoutDirectory,
              target: { _tag: "LocalBranch", name: "next" },
            })
            .pipe(Effect.forkScoped);
          yield* Deferred.await(checkoutRequested);
          const prematureCheckout = yield* Deferred.await(checkoutEntered).pipe(
            Effect.timeoutOption("50 millis"),
          );
          yield* Deferred.succeed(releaseCommit, undefined);
          yield* Fiber.join(committing);
          const result = yield* Fiber.join(checkingOut);
          expect(Option.isNone(prematureCheckout)).toBe(true);
          expect(result.head.branch).toBe("next");
          expect(events).toEqual(["commit-start", "commit-end", "checkout"]);
        }),
      ),
    );
    expect((await git("log", "main", "-1", "--format=%s")).stdout.trim()).toBe(
      "Coordinated",
    );
  },
);
