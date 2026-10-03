import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import {
  createRepositoryCoordination,
  type RepositoryWritePolicy,
} from "#server/repository/repository-coordination.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

const recoverPolicy: RepositoryWritePolicy = {
  name: "recover",
  locks: { refs: "wait", worktree: "wait" },
  duringOperation: "proceed",
};

let worktree = "";
let resolutions = 0;
beforeEach(async () => {
  worktree = await mkdtemp(join(tmpdir(), "rebase-coordination-"));
  await mkdir(join(worktree, ".git"));
  resolutions = 0;
});
afterEach(() => removeTemporaryDirectory(worktree));

function coordinationRun() {
  const git: GitCommandRunner = {
    stream: () => Stream.empty,
    run: () =>
      Effect.sync(() => {
        resolutions++;
        return {
          exitCode: 0,
          stderr: "",
          stdout: `${tmpdir()}\n${tmpdir()}\n`,
        };
      }),
  };
  const coordination = createRepositoryCoordination(git);
  return (operation: Effect.Effect<void, string> = Effect.void) =>
    Effect.runPromise(
      Effect.exit(coordination.run(worktree, recoverPolicy, operation)),
    );
}

it("resolves a worktree's Git directories once until an operation fails", async () => {
  const run = coordinationRun();

  await run();
  await run();
  const resolutionsBeforeFailure = resolutions;
  await run(Effect.fail("rejected"));
  await run();

  expect(resolutionsBeforeFailure).toBe(1);
  expect(resolutions).toBe(2);
});
