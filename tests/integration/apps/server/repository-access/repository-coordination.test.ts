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
import { createRepositoryChangesService } from "#server/features/repository-changes/index";
import { acquireWatchedRepository } from "#server/features/repository-history/freshness/watched-repository";
import { createRepositoryRefsService } from "#server/features/repository-refs/repository-refs";
import {
  createRepositoryAccess,
  createRepositoryCoordination,
} from "#server/repository/access/index";

const directories: string[] = [];
const execute = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it.each([
  { mutation: "commit", linked: false },
  { mutation: "commit", linked: true },
  { mutation: "fetch", linked: false },
  { mutation: "fetch", linked: true },
] as const)(
  "serializes $mutation and checkout across features, linked worktree: $linked",
  async ({ mutation, linked }) => {
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
            ...local,
            run: (command) =>
              Effect.gen(function* () {
                if (command.arguments.includes(mutation)) {
                  events.push("mutation-start");
                  yield* Deferred.succeed(commitEntered, undefined);
                  yield* Deferred.await(releaseCommit);
                  const result = yield* local.run(command);
                  events.push("mutation-end");
                  return result;
                }
                if (command.arguments[0] === "switch") {
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
          const access = createRepositoryAccess(catalog, runner);
          const changes = createRepositoryChangesService(
            access,
            runner,
            coordination,
          );
          const refs = createRepositoryRefsService({
            access,
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
          const freshness = yield* acquireWatchedRepository(
            {
              id: repositoryId,
              path: directory,
              name: "test",
              addedAt: "",
              lastOpenedAt: "",
            },
            new Set(),
            runner,
            { watch: () => Effect.succeed({ close: () => {} }) },
            coordination,
          );
          const committing = yield* (
            mutation === "fetch"
              ? freshness.fetch.pipe(Effect.asVoid)
              : changes
                  .commit({
                    ...scope,
                    revision: snapshot.revision,
                    message: "Coordinated",
                  })
                  .pipe(Effect.asVoid)
          ).pipe(Effect.forkScoped);
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
          expect(events).toEqual([
            "mutation-start",
            "mutation-end",
            "checkout",
          ]);
        }),
      ),
    );
    expect((await git("log", "main", "-1", "--format=%s")).stdout.trim()).toBe(
      mutation === "commit" ? "Coordinated" : "Initial",
    );
  },
);
