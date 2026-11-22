import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { createWorktreeLocations } from "#server/repository/repository-access.ts";
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
    stream: async function* () {},
    run: async () => {
      resolutions++;
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${worktree}\n${tmpdir()}\n${tmpdir()}\n`,
      };
    },
  };
  const coordination = createRepositoryCoordination(
    git,
    createWorktreeLocations(git),
  );
  return (operation: () => Promise<void> = async () => {}) =>
    coordination.run(worktree, recoverPolicy, operation).catch(() => {});
}

it("resolves a worktree's Git directories once until an operation fails", async () => {
  const run = coordinationRun();

  await run();
  await run();
  const resolutionsBeforeFailure = resolutions;
  await run(() => Promise.reject(new Error("rejected")));
  await run();

  expect(resolutionsBeforeFailure).toBe(1);
  expect(resolutions).toBe(2);
});
