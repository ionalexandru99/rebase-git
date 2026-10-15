import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { createRepository } from "#tests-support/git.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

const git = createLocalGitCommandRunner();
const waitForever = ["-c", "alias.wait-forever=!sleep 600", "wait-forever"];
let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "rebase-run-"));
  await createRepository(directory);
});

afterAll(async () => {
  await removeTemporaryDirectory(directory);
});

it("returns a rejected command's exit code and error output", async () => {
  const output = await Effect.runPromise(
    git.run({
      arguments: ["rev-parse", "--verify", "refs/heads/missing"],
      directory,
    }),
  );

  expect(output.exitCode).toBe(128);
  expect(output.stderr).toContain("Needed a single revision");
});

it("fails instead of returning cut-off output when Git prints more than allowed", async () => {
  const error = await Effect.runPromise(
    Effect.flip(
      git.run({
        arguments: ["log", "--format=%H %s"],
        directory,
        maxOutputBytes: 8,
      }),
    ),
  );

  expect(error.reason).toBe("OutputTooLarge");
});

it("stops Git and everything it started when the deadline passes", async () => {
  const error = await Effect.runPromise(
    Effect.flip(
      git.run({ arguments: waitForever, directory, timeoutMilliseconds: 100 }),
    ),
  );

  expect(error.reason).toBe("Timeout");
});

it("reports a run stopped from Diagnostics", async () => {
  const error = await Effect.runPromise(
    Effect.flip(
      git.run({
        arguments: waitForever,
        directory,
        onSpawn: (_pid, stop) => stop(),
      }),
    ),
  );

  expect(error).toMatchObject({
    reason: "Failed",
    detail: "Stopped from Diagnostics.",
  });
});
