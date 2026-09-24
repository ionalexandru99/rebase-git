import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { fastImport, git as runGit } from "#tests-support/git";

const git = createLocalGitCommandRunner();
let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "rebase-stream-"));
  await createHistory(directory);
});

afterAll(async () => {
  await rm(directory, {
    force: true,
    recursive: true,
    maxRetries: 3,
    retryDelay: 100,
  });
});

it("streams stdout and reports a rejected command with its exit code and stderr", async () => {
  const output = await Effect.runPromise(
    git
      .stream({ arguments: ["log", "--format=%H", "--all"], directory })
      .pipe(Stream.mkString),
  );
  const error = await Effect.runPromise(
    Effect.flip(
      Stream.runDrain(
        git.stream({
          arguments: ["rev-parse", "--verify", "refs/heads/missing"],
          directory,
        }),
      ),
    ),
  );

  expect(output.trim().split("\n")).toHaveLength(2_000);
  expect(error).toMatchObject({ exitCode: 128, reason: "Failed" });
  expect(error.stderr).toContain("Needed a single revision");
});

it("fails with a timeout when the command outlives its deadline", async () => {
  const error = await Effect.runPromise(
    Effect.flip(
      git
        .stream({
          arguments: ["log", "--format=%H %s", "--all"],
          directory,
          timeoutMilliseconds: 200,
        })
        .pipe(Stream.runForEach(() => Effect.sleep(500))),
    ),
  );

  expect(error.reason).toBe("Timeout");
}, 10_000);

it("stops Git when the consumer finishes early", async () => {
  const chunks = await Effect.runPromise(
    git
      .stream({ arguments: ["log", "--format=%H %s", "--all"], directory })
      .pipe(Stream.take(1), Stream.runCollect),
  );

  expect(chunks).toHaveLength(1);
}, 10_000);

async function createHistory(directory: string) {
  await runGit(directory, "init", "-b", "main");
  const commands: string[] = [];
  for (let index = 0; index < 2_000; index += 1) {
    const subject = `commit ${index} ${"x".repeat(1_024)}`;
    commands.push(
      "commit refs/heads/main\n",
      `mark :${index + 1}\n`,
      `committer Rebase test <rebase@example.test> ${1_700_000_000 + index} +0000\n`,
      `data ${Buffer.byteLength(subject)}\n${subject}\n`,
      index === 0 ? "" : `from :${index}\n`,
      "\n",
    );
  }
  await fastImport(directory, commands.join(""));
}
