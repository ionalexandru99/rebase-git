import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vite-plus/test";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import { RepositoryPullApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { createRepository } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

const execute = promisify(execFile);

it.each([
  { mutation: "commit", linked: false },
  { mutation: "commit", linked: true },
  { mutation: "fetch", linked: false },
  { mutation: "fetch", linked: true },
] as const)(
  "serializes $mutation and checkout across features, linked worktree: $linked",
  async ({ mutation, linked }) => {
    const commitEntered = Promise.withResolvers<void>();
    const releaseCommit = Promise.withResolvers<void>();
    const checkoutRequested = Promise.withResolvers<void>();
    const events: string[] = [];
    const environment = await openTestEnvironment({
      git: (local) => ({
        ...local,
        run: async (command) => {
          if (command.arguments.includes(mutation)) {
            events.push("mutation-start");
            commitEntered.resolve();
            await releaseCommit.promise;
            const result = await local.run(command);
            events.push("mutation-end");
            return result;
          }
          if (command.arguments[0] === "switch") events.push("checkout");
          return local.run(command);
        },
      }),
      coordination: (coordination) => ({
        ...coordination,
        run: (path, policy, operation) => {
          if (policy.name === "checkout") checkoutRequested.resolve();
          return coordination.run(path, policy, operation);
        },
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

    const scope = { repositoryId, worktreePath: directory, amend: false };
    const snapshot = await changes.read(scope);
    const committing =
      mutation === "fetch"
        ? pull.fetch({ repositoryId }).catch(() => {})
        : changes.commit({
            ...scope,
            revision: snapshot.revision,
            message: "Coordinated",
          });
    await commitEntered.promise;
    const checkingOut = refs.checkout({
      repositoryId,
      worktreePath: checkoutDirectory,
      target: { _tag: "LocalBranch", name: "next" },
    });
    await checkoutRequested.promise;
    expect(events).toEqual(["mutation-start"]);
    releaseCommit.resolve();
    await committing;
    const result = await checkingOut;
    expect(result.head.branch).toBe("next");
    expect(events).toEqual(["mutation-start", "mutation-end", "checkout"]);
    expect((await git("log", "main", "-1", "--format=%s")).stdout.trim()).toBe(
      mutation === "commit" ? "Coordinated" : "Initial",
    );
  },
);

it("reads changes while a commit holds the worktree", async () => {
  const commitEntered = Promise.withResolvers<void>();
  const releaseCommit = Promise.withResolvers<void>();
  const environment = await openTestEnvironment({
    git: (local) => ({
      ...local,
      run: async (command) => {
        if (command.arguments[0] === "commit") {
          commitEntered.resolve();
          await releaseCommit.promise;
        }
        return local.run(command);
      },
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

  const scope = { repositoryId, worktreePath: directory, amend: false };
  const snapshot = await changes.read(scope);
  const committing = changes.commit({
    ...scope,
    revision: snapshot.revision,
    message: "Held",
  });
  await commitEntered.promise;

  await Promise.all([
    changes.read(scope),
    changes.diff({ ...scope, section: "staged", path: "file.txt" }),
  ]);
  releaseCommit.resolve();
  await committing;
  expect((await git("log", "-1", "--format=%s")).stdout.trim()).toBe("Held");
});
