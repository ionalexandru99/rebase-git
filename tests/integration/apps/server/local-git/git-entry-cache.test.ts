import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { cacheByGitEntry } from "#server/adapters/local-git/git-commands.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

let parent = "";
let reads: string[] = [];
beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "rebase-git-entry-cache-"));
  reads = [];
});
afterEach(() => removeTemporaryDirectory(parent));

async function repository(name: string) {
  const path = join(parent, name);
  await mkdir(join(path, ".git"), { recursive: true });
  return path;
}

function countingCache() {
  return cacheByGitEntry((directory) =>
    Effect.sync(() => {
      reads.push(directory);
      return reads.length;
    }),
  );
}

it("reads each repository once", async () => {
  const first = await repository("first");
  const second = await repository("second");
  const cache = countingCache();

  const values = await Effect.runPromise(
    Effect.all([cache.read(first), cache.read(first), cache.read(second)]),
  );

  expect(values).toEqual([1, 1, 2]);
  expect(reads).toEqual([first, second]);
});

it("reads again when the repository is replaced", async () => {
  const path = await repository("replaced");
  const cache = countingCache();
  await Effect.runPromise(cache.read(path));

  await mkdir(join(path, "replacement"));
  await rm(join(path, ".git"), { recursive: true });
  await rename(join(path, "replacement"), join(path, ".git"));
  await Effect.runPromise(cache.read(path));

  expect(reads).toEqual([path, path]);
});

it("keeps the value when Git publishes a new index", async () => {
  const path = await repository("indexed");
  const cache = countingCache();
  await Effect.runPromise(cache.read(path));

  await writeFile(join(path, ".git", "index.lock"), "");
  await rename(join(path, ".git", "index.lock"), join(path, ".git", "index"));
  await Effect.runPromise(cache.read(path));

  expect(reads).toEqual([path]);
});

it("reads again after the repository is forgotten", async () => {
  const path = await repository("forgotten");
  const cache = countingCache();
  await Effect.runPromise(cache.read(path));

  cache.forget(path);
  await Effect.runPromise(cache.read(path));

  expect(reads).toEqual([path, path]);
});
