import { randomUUID } from "node:crypto";
import { copyFile, open, readFile, rename, rm } from "node:fs/promises";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import {
  changeGit,
  changeIo,
  changesError,
} from "#server/features/repository-changes/git/change-git";

export function withChangeIndex<A, E>(
  git: GitCommandRunner,
  directory: string,
  mutate: (indexFile: string) => Effect.Effect<A, E>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const index = (yield* changeGit(git, directory, [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "index",
      ])).trim();
      const lockPath = `${index}.lock`;
      const temporary = `${index}.rebase-${randomUUID()}`;
      let published = false;
      const lock = yield* Effect.acquireRelease(
        changeIo(() => open(lockPath, "wx")).pipe(
          Effect.mapError(() =>
            changesError(
              "Busy",
              "The Git index is locked by another operation. Try again when it finishes.",
            ),
          ),
        ),
        (handle) =>
          Effect.promise(async () => {
            await handle.close().catch(() => undefined);
            if (!published) await rm(lockPath, { force: true });
            await rm(temporary, { force: true });
            await rm(`${temporary}.lock`, { force: true });
          }),
      );
      const copied = yield* changeIo(() =>
        copyFile(index, temporary)
          .then(() => true)
          .catch((error) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            return false;
          }),
      );
      if (!copied)
        yield* changeGit(git, directory, ["read-tree", "--empty"], {
          indexFile: temporary,
        });
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const result = yield* mutate(temporary);
          yield* changeIo(async () => {
            await lock.writeFile(await readFile(temporary));
            await lock.sync();
            await lock.close();
            await rename(lockPath, index);
            published = true;
          });
          return result;
        }),
      );
    }),
  );
}
