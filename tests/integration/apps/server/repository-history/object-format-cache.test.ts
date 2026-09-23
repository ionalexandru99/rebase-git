import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { createObjectFormatCache } from "#server/features/repository-history/git/read-object-format";

let parent = "";
let reads: string[] = [];
beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "rebase-object-format-"));
  reads = [];
});
afterEach(() => rm(parent, { recursive: true, force: true }));

async function repository(name: string) {
  const path = join(parent, name);
  await mkdir(join(path, ".git"), { recursive: true });
  return path;
}

function objectFormatCache(format: string) {
  const git: GitCommandRunner = {
    stream: () => Stream.empty,
    run: (command) =>
      Effect.sync(() => {
        reads.push(command.directory);
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
  const objectFormat = objectFormatCache("sha1");
  await Effect.runPromise(objectFormat(path));

  await mkdir(join(path, "replacement"));
  await rm(join(path, ".git"), { recursive: true });
  await rename(join(path, "replacement"), join(path, ".git"));
  await Effect.runPromise(objectFormat(path));

  expect(reads).toEqual([path, path]);
});
