import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type CheckoutRepositoryRef,
  RepositoryChangesHttpApi,
  RepositoryOperationsHttpApi,
  RepositoryRefsHttpApi,
} from "@rebase/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { afterEach, expect, it } from "vite-plus/test";
import type { RepositoryWritePolicy } from "#server/repository/repository-coordination";
import {
  createDivergedRepository,
  startConflict,
} from "#tests-support/diverged-repository";
import { openTestEnvironment } from "#tests-support/server";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const exec = promisify(execFile);
const refsAndWorktreeWrite: RepositoryWritePolicy = {
  name: "write refs and worktree",
  locks: { refs: "wait", worktree: "wait" },
  duringOperation: "block",
};
const worktreeWrite: RepositoryWritePolicy = {
  name: "write worktree",
  locks: { worktree: "wait" },
  duringOperation: "proceed",
};
const refsWriteIfAvailable: RepositoryWritePolicy = {
  name: "write refs if available",
  locks: { refs: "ifAvailable" },
  duringOperation: "proceed",
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => removeTemporaryDirectory(path)),
  );
});

async function fixture() {
  const { directory, git } = await createDivergedRepository();
  directories.push(directory);
  const environment = await openTestEnvironment();
  const repositoryId = (await environment.remember(directory)).id;
  const { coordination } = environment;
  const changes = environment.routes(RepositoryChangesHttpApi);
  const operations = environment.routes(RepositoryOperationsHttpApi);
  const refs = environment.routes(RepositoryRefsHttpApi);
  const scope = { repositoryId, worktreePath: directory };
  const continueOperation = async () =>
    Effect.runPromise(
      operations.execute({
        ...scope,
        revision: (await Effect.runPromise(operations.read(scope))).revision,
        action: "continue",
      }),
    );
  const checkout = (target: CheckoutRepositoryRef["target"]) =>
    Effect.runPromise(refs.checkout({ ...scope, target }));
  return {
    directory,
    git,
    coordination,
    changes,
    checkout,
    scope,
    continueOperation,
  };
}

it("rejects incompatible writes during a merge and stages its resolution", async () => {
  const f = await fixture();
  await startConflict(f.git, "merge");
  await writeFile(join(f.directory, "file.txt"), "resolved\n");
  const scope = { ...f.scope, amend: false };
  const snapshot = await Effect.runPromise(f.changes.read(scope));
  const incompatible = { _tag: "RepositoryRejected", reason: "Incompatible" };
  await expect(
    Effect.runPromise(
      f.changes.commit({
        ...scope,
        revision: snapshot.revision,
        message: "during merge",
      }),
    ),
  ).rejects.toMatchObject(incompatible);
  await expect(
    Effect.runPromise(
      f.changes.mutate({
        ...scope,
        revision: snapshot.revision,
        action: "discard",
        section: "unstaged",
        selection: { _tag: "All" },
      }),
    ),
  ).rejects.toMatchObject(incompatible);
  await expect(
    f.checkout({ _tag: "LocalBranch", name: "topic" }),
  ).rejects.toMatchObject(incompatible);
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
            refsAndWorktreeWrite,
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(record("first")),
            ),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        const fetch = yield* f.coordination
          .run(linked, refsWriteIfAvailable, Effect.die("Fetch must not start"))
          .pipe(Effect.flip);
        expect(fetch.reason).toBe("Busy");
        const second = yield* f.coordination
          .run(linked, refsAndWorktreeWrite, record("second"))
          .pipe(Effect.forkScoped);
        yield* f.coordination.run(linked, worktreeWrite, record("stage"));
        expect(order).toEqual(["stage"]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        expect(order).toEqual(["stage", "first", "second"]);
      }),
    ),
  );
});
