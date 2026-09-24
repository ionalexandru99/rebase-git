import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { createObjectFormatCache } from "#server/features/repository-history/git/read-object-format";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

let parent = "";
let reads: string[] = [];
beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "rebase-object-format-"));
  reads = [];
});
afterEach(() => removeTemporaryDirectory(parent));

async function repository(name: string) {
  const path = join(parent, name);
  await mkdir(join(path, ".git"), { recursive: true });
  return path;
}

function objectFormatCache(...formats: string[]) {
  const git: GitCommandRunner = {
    stream: () => Stream.empty,
    run: (command) =>
      Effect.sync(() => {
        reads.push(command.directory);
        const format = formats[Math.min(reads.length, formats.length) - 1];
        return { exitCode: 0, stderr: "", stdout: `${format}\n` };
      }),
  };
  return createObjectFormatCache(git);
}

it("asks Git for each repository's object format once", async () => {
  const first = await repository("first");
  const second = await repository("second");
  const objectFormat = objectFormatCache("sha256");

  const formats = await Effect.runPromise(
    Effect.all([
      objectFormat(first),
      objectFormat(first),
      objectFormat(second),
    ]),
  );

  expect(formats).toEqual(["sha256", "sha256", "sha256"]);
  expect(reads).toEqual([first, second]);
});

it("asks Git again when the repository is replaced", async () => {
  const path = await repository("replaced");
  const objectFormat = objectFormatCache("sha1", "sha256");
  const before = await Effect.runPromise(objectFormat(path));

  await mkdir(join(path, "replacement"));
  await rm(join(path, ".git"), { recursive: true });
  await rename(join(path, "replacement"), join(path, ".git"));
  const after = await Effect.runPromise(objectFormat(path));

  expect([before, after]).toEqual(["sha1", "sha256"]);
  expect(reads).toEqual([path, path]);
});
