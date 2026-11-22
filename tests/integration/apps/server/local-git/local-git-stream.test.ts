import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import {
  createRepository,
  fastImport,
  gitWaitingForever,
} from "#tests-support/git.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

const git = createLocalGitCommandRunner();
let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "rebase-stream-"));
  await createHistory(directory);
});

afterAll(async () => {
  await removeTemporaryDirectory(directory);
});

it("streams stdout and reports a rejected command with its exit code and stderr", async () => {
  const output = (
    await collect(
      git.stream({ arguments: ["log", "--format=%H", "--all"], directory }),
    )
  ).join("");
  const rejected = collect(
    git.stream({
      arguments: ["rev-parse", "--verify", "refs/heads/missing"],
      directory,
    }),
  );

  expect(output.trim().split("\n")).toHaveLength(2_000);
  await expect(rejected).rejects.toMatchObject({
    exitCode: 128,
    reason: "Failed",
    detail: expect.stringContaining("Needed a single revision"),
  });
});

it("fails with a timeout when the command outlives its deadline", async () => {
  const consume = async () => {
    for await (const _ of git.stream({
      arguments: ["log", "--format=%H %s", "--all"],
      directory,
      timeoutMilliseconds: 200,
    }))
      await new Promise((resolve) => setTimeout(resolve, 500));
  };

  await expect(consume()).rejects.toMatchObject({ reason: "Timeout" });
});

it("stops Git and everything it started when the consumer finishes early", async () => {
  let pid = 0;
  for await (const chunk of git.stream({
    arguments: gitWaitingForever,
    directory,
  })) {
    pid = Number(chunk.trim());
    break;
  }

  expect(pid).toBeGreaterThan(0);
  await expect.poll(() => isRunning(pid)).toBe(false);
});

async function createHistory(directory: string) {
  await createRepository(directory, { commits: [] });
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

async function collect(chunks: AsyncIterable<string>) {
  const collected: string[] = [];
  for await (const chunk of chunks) collected.push(chunk);
  return collected;
}

function isRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
