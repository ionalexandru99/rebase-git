import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  RepositoryChangesHttpApi,
  RepositoryRefsHttpApi,
} from "@rebase/contracts";
import { Deferred, Effect, Fiber, Option } from "effect";
import { afterEach, expect, it } from "vite-plus/test";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/events/environment-event-publisher";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { EnvironmentEvents } from "#server/domain/environment-event-publisher.contract";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryWatching } from "#server/domain/repository-watcher.contract";
import { repositoryChangesFeature } from "#server/features/repository-changes/index";
import { acquireWatchedRepository } from "#server/features/repository-history/freshness/watched-repository";
import { repositoryRefsFeature } from "#server/features/repository-refs/index";
import {
  createRepositoryAccess,
  createRepositoryCoordination,
} from "#server/repository/access/index";
import {
  featureRoutesClient,
  provideRepositoryServices,
  repositoryFeatureClient,
} from "#tests-integration/apps/server/environment-connection/feature-routes-client";
import { createRepository } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const directories: string[] = [];
const execute = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => removeTemporaryDirectory(directory)),
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
    await createRepository(directory, { commits: [] });
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
          const access = createRepositoryAccess(
            catalog,
            runner,
            createLocalRepositoryWatcher(),
          );
          const changes = repositoryFeatureClient(
            RepositoryChangesHttpApi,
            repositoryChangesFeature,
            { access, git: runner, coordination },
          );
          const refsFeature = yield* repositoryRefsFeature.pipe(
            provideRepositoryServices({
              access,
              git: runner,
              coordination: {
                ...coordination,
                run: (path, policy, operation) =>
                  Deferred.succeed(checkoutRequested, undefined).pipe(
                    Effect.andThen(coordination.run(path, policy, operation)),
                  ),
              },
            }),
            Effect.provideService(
              RepositoryWatching,
              createLocalRepositoryWatcher(),
            ),
            Effect.provideService(
              EnvironmentEvents,
              createEnvironmentEventPublisher(),
            ),
          );
          const refs = featureRoutesClient(
            RepositoryRefsHttpApi,
            refsFeature.httpRoutes,
          );
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

it("reads changes while a commit holds the worktree", async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "rebase-coordination-")),
  );
  directories.push(directory);
  const git = (...args: string[]) => execute("git", ["-C", directory, ...args]);
  await createRepository(directory, { commits: [] });
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.test");
  await git("config", "commit.gpgsign", "false");
  await writeFile(join(directory, "file.txt"), "initial\n");
  await git("add", ".");
  await git("commit", "-m", "Initial");
  await writeFile(join(directory, "file.txt"), "committed\n");
  await git("add", ".");

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const commitEntered = yield* Deferred.make<void>();
        const releaseCommit = yield* Deferred.make<void>();
        const local = createLocalGitCommandRunner();
        const runner: GitCommandRunner = {
          ...local,
          run: (command) =>
            command.arguments[0] === "commit"
              ? Deferred.succeed(commitEntered, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseCommit)),
                  Effect.andThen(local.run(command)),
                )
              : local.run(command),
        };
        const repositoryId = randomUUID();
        const changes = repositoryFeatureClient(
          RepositoryChangesHttpApi,
          repositoryChangesFeature,
          {
            access: createRepositoryAccess(
              {
                find: () =>
                  Effect.succeed({
                    id: repositoryId,
                    path: directory,
                    name: "test",
                    addedAt: "",
                    lastOpenedAt: "",
                  }),
              },
              runner,
              createLocalRepositoryWatcher(),
            ),
            git: runner,
            coordination: createRepositoryCoordination(runner),
          },
        );
        const scope = { repositoryId, worktreePath: directory, amend: false };
        const snapshot = yield* changes.read(scope);
        const committing = yield* changes
          .commit({ ...scope, revision: snapshot.revision, message: "Held" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(commitEntered);

        const reads = yield* Effect.all([
          changes.read(scope),
          changes.diff({ ...scope, section: "staged", path: "file.txt" }),
        ]).pipe(Effect.timeoutOption("5 seconds"));
        yield* Deferred.succeed(releaseCommit, undefined);
        yield* Fiber.join(committing);

        expect(Option.isSome(reads)).toBe(true);
      }),
    ),
  );
  expect((await git("log", "-1", "--format=%s")).stdout.trim()).toBe("Held");
});
