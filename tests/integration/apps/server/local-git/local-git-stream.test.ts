import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { promisify } from "node:util";
import { createLocalGitCommandRunner } from "@rebase/server/adapters/local-git/local-git-command-runner";
import { Effect } from "effect";
import { expect, it } from "vitest";

const execute = promisify(execFile);

it("observes a Git abort while stdout processing is pending and preserves its failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rebase-stream-abort-"));
  const entered = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const processing = Promise.withResolvers<void>();
  const failure = new Error("The stdout consumer stopped");
  try {
    await createHistory(directory);
    const stream = createLocalGitCommandRunner().stream;
    if (stream === undefined) throw new Error("Git streaming is unavailable");
    const result = Effect.runPromise(
      Effect.flip(
        stream(
          {
            arguments: ["log", "--format=%H %s", "--all"],
            directory,
            timeoutMilliseconds: 2_000,
          },
          async (chunk, signal) => {
            expect(chunk.length).toBeGreaterThan(0);
            signal.addEventListener("abort", () => aborted.resolve(), {
              once: true,
            });
            entered.resolve();
            await processing.promise;
          },
        ),
      ),
    );
    try {
      await entered.promise;
      await aborted.promise;
      await setImmediate();
      processing.reject(failure);
      const error = await result;
      expect(error.reason).toBe("Timeout");
      expect(error.cause).toBe(failure);
    } finally {
      processing.resolve();
      await result;
    }
  } finally {
    await rm(directory, {
      force: true,
      recursive: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}, 10_000);

async function createHistory(directory: string) {
  await execute("git", ["-C", directory, "init", "-b", "main"]);
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
  const imported = execute("git", ["-C", directory, "fast-import", "--quiet"]);
  imported.child.stdin?.end(`${commands.join("")}done\n`);
  await imported;
}
