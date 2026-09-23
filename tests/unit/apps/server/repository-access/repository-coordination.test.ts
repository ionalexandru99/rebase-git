import { tmpdir } from "node:os";
import { Effect, Stream } from "effect";
import { expect, it } from "vite-plus/test";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { createRepositoryCoordination } from "#server/repository/access/index";

it("resolves a worktree's Git directories once until an operation fails", async () => {
  let resolutions = 0;
  const git: GitCommandRunner = {
    stream: () => Stream.empty,
    run: () =>
      Effect.sync(() => {
        resolutions++;
        return { exitCode: 0, stderr: "", stdout: `${tmpdir()}\n` };
      }),
  };
  const coordination = createRepositoryCoordination(git);
  const run = (operation: Effect.Effect<void, string>) =>
    Effect.runPromise(
      Effect.exit(
        coordination.run("/worktree", "worktree-and-refs", operation),
      ),
    );

  await run(Effect.void);
  await run(Effect.void);
  const resolutionsBeforeFailure = resolutions;
  await run(Effect.fail("rejected"));
  await run(Effect.void);

  expect(resolutionsBeforeFailure).toBe(2);
  expect(resolutions).toBe(4);
});
