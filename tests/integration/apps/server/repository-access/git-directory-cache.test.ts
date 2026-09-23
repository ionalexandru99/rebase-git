import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { createRepositoryCoordination } from "#server/repository/access/index";

let worktree = "";
let resolutions = 0;
beforeEach(async () => {
  worktree = await mkdtemp(join(tmpdir(), "rebase-coordination-"));
  await mkdir(join(worktree, ".git"));
  resolutions = 0;
});
afterEach(() => rm(worktree, { recursive: true, force: true }));

function coordinationRun() {
  const git: GitCommandRunner = {
    stream: () => Stream.empty,
    run: () =>
      Effect.sync(() => {
        resolutions++;
        return { exitCode: 0, stderr: "", stdout: `${tmpdir()}\n` };
      }),
  };
  const coordination = createRepositoryCoordination(git);
  return (operation: Effect.Effect<void, string> = Effect.void) =>
    Effect.runPromise(
      Effect.exit(coordination.run(worktree, "worktree-and-refs", operation)),
    );
}

it("resolves a worktree's Git directories once until an operation fails", async () => {
  const run = coordinationRun();

  await run();
  await run();
  const resolutionsBeforeFailure = resolutions;
  await run(Effect.fail("rejected"));
  await run();

  expect(resolutionsBeforeFailure).toBe(2);
  expect(resolutions).toBe(4);
});

it("resolves the Git directories again when the worktree is replaced", async () => {
  const run = coordinationRun();
  await run();

  await rm(join(worktree, ".git"), { recursive: true });
  await mkdir(join(worktree, ".git"));
  await run();

  expect(resolutions).toBe(4);
});
