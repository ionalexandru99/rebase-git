import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Deferred, Effect, Fiber } from "effect";
import { afterEach, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { createRepositoryChangesService } from "#server/features/repository-changes/repository-changes";
import { createRepositoryOperationsService } from "#server/features/repository-operations/repository-operations";
import {
  createRepositoryAccess,
  createRepositoryCoordination,
} from "#server/repository/access/index";
import {
  createDivergedRepository,
  startConflict,
} from "#tests-support/diverged-repository";

const exec = promisify(execFile);
const directories: string[] = [];
const repositoryId = "00000000-0000-4000-8000-000000000001";
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const { directory, git } = await createDivergedRepository();
  directories.push(directory);
  const runner = createLocalGitCommandRunner();
  const access = createRepositoryAccess(
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
  );
  const coordination = createRepositoryCoordination(runner);
  const changes = createRepositoryChangesService(access, runner, coordination);
  const operations = createRepositoryOperationsService(
    access,
    runner,
    coordination,
  );
  const scope = { repositoryId, worktreePath: directory };
  const continueOperation = async () =>
    Effect.runPromise(
      operations.execute({
        ...scope,
        revision: (await Effect.runPromise(operations.read(scope))).revision,
        action: "continue",
      }),
    );
  return { directory, git, coordination, changes, scope, continueOperation };
}

it("rejects incompatible writes during a merge and stages its resolution", async () => {
  const f = await fixture();
  await startConflict(f.git, "merge");
  for (const write of ["checkout", "commit", "discard"] as const)
    await expect(
      Effect.runPromise(f.coordination.run(f.directory, write, Effect.void)),
    ).rejects.toMatchObject({ reason: "Incompatible" });
  await writeFile(join(f.directory, "file.txt"), "resolved\n");
  const scope = { ...f.scope, amend: false };
  const snapshot = await Effect.runPromise(f.changes.read(scope));
  await Effect.runPromise(
    f.changes.mutate({
      ...scope,
      revision: snapshot.revision,
      action: "stage",
      section: "unstaged",
      selection: { _tag: "Files", paths: ["file.txt"] },
    }),
  );
  expect((await f.continueOperation()).kind).toBe("idle");
  expect((await f.git("show", "HEAD:file.txt")).stdout).toBe("resolved\n");
});

it("amends the commit at a rebase edit stop before continuing", async () => {
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
  await writeFile(join(f.directory, "file.txt"), "amended\n");
  await f.git("add", "file.txt");
  const amendment = { ...f.scope, amend: true };
  const snapshot = await Effect.runPromise(f.changes.read(amendment));
  await Effect.runPromise(
    f.changes.commit({
      ...amendment,
      revision: snapshot.revision,
      message: "amended topic",
    }),
  );
  expect((await f.continueOperation()).kind).toBe("idle");
  expect((await f.git("show", "HEAD:file.txt")).stdout).toBe("amended\n");
});

it("skips a contended fetch while ref writers queue across worktrees", async () => {
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
        const record = (step: string) =>
          Effect.sync(() => {
            order.push(step);
          });
        const first = yield* f.coordination
          .run(
            f.directory,
            "commit",
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(record("first")),
            ),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        const fetch = yield* f.coordination
          .run(linked, "fetch", Effect.die("Fetch must not start"))
          .pipe(Effect.flip, Effect.timeout("1 second"));
        expect(fetch.reason).toBe("Busy");
        const second = yield* f.coordination
          .run(linked, "commit", record("second"))
          .pipe(Effect.forkScoped);
        yield* f.coordination.run(linked, "stage", record("stage"));
        expect(order).toEqual(["stage"]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        expect(order).toEqual(["stage", "first", "second"]);
      }),
    ),
  );
});
