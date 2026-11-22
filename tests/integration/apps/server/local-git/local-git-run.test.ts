import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { createRepository, gitWaitingForever } from "#tests-support/git.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

const git = createLocalGitCommandRunner();
let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "rebase-run-"));
  await createRepository(directory);
});

afterAll(async () => {
  await removeTemporaryDirectory(directory);
});

it("returns a rejected command's exit code and error output", async () => {
  const output = await git.run({
    arguments: ["rev-parse", "--verify", "refs/heads/missing"],
    directory,
  });

  expect(output.exitCode).toBe(128);
  expect(output.stderr).toContain("Needed a single revision");
});

it("fails instead of returning cut-off output when Git prints more than allowed", async () => {
  await expect(
    git.run({
      arguments: ["log", "--format=%H %s"],
      directory,
      maxOutputBytes: 8,
    }),
  ).rejects.toMatchObject({ reason: "OutputTooLarge" });
});

it("stops Git and everything it started when the deadline passes", async () => {
  await expect(
    git.run({
      arguments: gitWaitingForever,
      directory,
      timeoutMilliseconds: 1_000,
    }),
  ).rejects.toMatchObject({ reason: "Timeout" });
});

it("reports a run stopped from Diagnostics", async () => {
  let stop = () => {};
  await expect(
    git.run({
      arguments: gitWaitingForever,
      directory,
      onSpawn: (_pid, stopRun) => {
        stop = stopRun;
      },
      progressStream: "stdout",
      progress: () => stop(),
    }),
  ).rejects.toMatchObject({
    reason: "Failed",
    detail: "Stopped from Diagnostics.",
  });
});
