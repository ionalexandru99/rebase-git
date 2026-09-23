import { randomUUID } from "node:crypto";
import { copyFile, open, rename, rm, stat, utimes } from "node:fs/promises";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import {
  changeIo,
  changesError,
} from "#server/features/repository-changes/git/change-failures";
import { runRepositoryGit } from "#server/repository/access/index";

export function withChangeIndex<A, E>(
  git: GitCommandRunner,
  directory: string,
  mutate: (indexFile: string) => Effect.Effect<A, E>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const index = (yield* runRepositoryGit(git, directory, [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "index",
      ])).trim();
      const lockPath = `${index}.lock`;
      const temporary = `${index}.rebase-${randomUUID()}`;
      yield* Effect.acquireRelease(
        changeIo(async () => {
          const lock = await open(lockPath, "wx");
          await lock.close().catch(() => undefined);
        }).pipe(
          Effect.mapError(() =>
            changesError(
              "Busy",
              "The Git index is locked by another operation. Try again when it finishes.",
            ),
          ),
        ),
        () =>
          Effect.promise(async () => {
            await rm(temporary, { force: true });
            await rm(`${temporary}.lock`, { force: true });
            await rm(lockPath, { force: true });
          }),
      );
      const copied = yield* changeIo(() =>
        copyIndex(index, temporary)
          .then(() => true)
          .catch((error) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            return false;
          }),
      );
      if (!copied)
        yield* runRepositoryGit(git, directory, ["read-tree", "--empty"], {
          indexFile: temporary,
        });
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const result = yield* mutate(temporary);
          yield* changeIo(async () => {
            const published = await open(temporary, "r+");
            await published.sync().finally(() => published.close());
            await rename(temporary, index);
          });
          return result;
        }),
      );
    }),
  );
}

async function copyIndex(index: string, temporary: string) {
  const { atime, mtime } = await stat(index);
  await copyFile(index, temporary);
  await utimes(temporary, atime, mtime);
}
