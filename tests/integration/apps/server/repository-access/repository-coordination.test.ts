import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  RepositoryChangesApi,
  RepositoryPullApi,
  RepositoryRefsApi,
} from "@rebase/contracts";
import { Deferred, Effect, Fiber, Option } from "effect";
import { expect, it } from "vite-plus/test";
import { createRepository } from "#tests-support/git";
import { openTestEnvironment } from "#tests-support/server";

const execute = promisify(execFile);

it.each([
  { mutation: "commit", linked: false },
  { mutation: "commit", linked: true },
  { mutation: "fetch", linked: false },
  { mutation: "fetch", linked: true },
] as const)(
  "serializes $mutation and checkout across features, linked worktree: $linked",
  async ({ mutation, linked }) => {
    const commitEntered = Deferred.makeUnsafe<void>();
    const releaseCommit = Deferred.makeUnsafe<void>();
    const checkoutEntered = Deferred.makeUnsafe<void>();
    const checkoutRequested = Deferred.makeUnsafe<void>();
    const events: string[] = [];
    const environment = await openTestEnvironment({
      git: (local) => ({
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
      }),
      coordination: (coordination) => ({
        ...coordination,
        run: (path, policy, operation) =>
          policy.name === "checkout"
            ? Deferred.succeed(checkoutRequested, undefined).pipe(
                Effect.andThen(coordination.run(path, policy, operation)),
              )
            : coordination.run(path, policy, operation),
      }),
    });
    const root = environment.home;
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
    const repository = await environment.remember(directory);
    const repositoryId = repository.id;
    const changes = environment.routes(RepositoryChangesApi);
    const refs = environment.routes(RepositoryRefsApi);
    const pull = environment.routes(RepositoryPullApi);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scope = { repositoryId, worktreePath: directory, amend: false };
          const snapshot = yield* changes.read(scope);
          const committing = yield* (
            mutation === "fetch"
              ? pull.fetch({ repositoryId }).pipe(Effect.ignore)
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
  const commitEntered = Deferred.makeUnsafe<void>();
  const releaseCommit = Deferred.makeUnsafe<void>();
  const environment = await openTestEnvironment({
    git: (local) => ({
      ...local,
      run: (command) =>
        command.arguments[0] === "commit"
          ? Deferred.succeed(commitEntered, undefined).pipe(
              Effect.andThen(Deferred.await(releaseCommit)),
              Effect.andThen(local.run(command)),
            )
          : local.run(command),
    }),
  });
  const directory = join(environment.home, "repository");
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
  const repositoryId = (await environment.remember(directory)).id;
  const changes = environment.routes(RepositoryChangesApi);

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const scope = { repositoryId, worktreePath: directory, amend: false };
        const snapshot = yield* changes.read(scope);
        const committing = yield* changes
          .commit({ ...scope, revision: snapshot.revision, message: "Held" })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(commitEntered);

        yield* Effect.all([
          changes.read(scope),
          changes.diff({ ...scope, section: "staged", path: "file.txt" }),
        ]);
        yield* Deferred.succeed(releaseCommit, undefined);
        yield* Fiber.join(committing);
      }),
    ),
  );
  expect((await git("log", "-1", "--format=%s")).stdout.trim()).toBe("Held");
});
