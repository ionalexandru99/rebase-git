import { randomUUID } from "node:crypto";
import { copyFile, open, rename, rm, stat, utimes } from "node:fs/promises";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import { uninterruptible } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";

export async function withChangeIndex<Value>(
  git: GitCommandRunner,
  directory: string,
  mutate: (indexFile: string) => Promise<Value>,
) {
  const index = (
    await runRepositoryGit(git, directory, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ])
  ).trim();
  const lockPath = `${index}.lock`;
  const temporary = `${index}.rebase-${randomUUID()}`;
  try {
    const lock = await open(lockPath, "wx");
    await lock.close().catch(() => undefined);
  } catch {
    throw repositoryRejected(
      "Busy",
      "The Git index is locked by another operation. Try again when it finishes.",
    );
  }
  try {
    const copied = await changeIo(() =>
      copyIndex(index, temporary)
        .then(() => true)
        .catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          return false;
        }),
    );
    if (!copied)
      await runRepositoryGit(git, directory, ["read-tree", "--empty"], {
        indexFile: temporary,
      });
    return await uninterruptible(async () => {
      const result = await mutate(temporary);
      await changeIo(async () => {
        const published = await open(temporary, "r+");
        await published.sync().finally(() => published.close());
        await rename(temporary, index);
      });
      return result;
    });
  } finally {
    await rm(temporary, { force: true });
    await rm(`${temporary}.lock`, { force: true });
    await rm(lockPath, { force: true });
  }
}

export async function copyIndex(index: string, temporary: string) {
  const { atime, mtime } = await stat(index);
  await copyFile(index, temporary);
  await utimes(temporary, atime, mtime);
}
