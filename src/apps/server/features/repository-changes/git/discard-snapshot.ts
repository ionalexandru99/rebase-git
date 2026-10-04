import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { Effect } from "effect";
import {
  changesFailed,
  type DiscardedChanges,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";
import { copyIndex } from "#server/features/repository-changes/git/change-index.ts";
import { patchOptions } from "#server/features/repository-changes/git/mutate-changes.ts";

export function snapshotChanges(
  git: GitCommandRunner,
  directory: string,
  index: string,
  {
    paths,
    conflicted,
  }: {
    readonly paths: readonly string[];
    readonly conflicted: readonly string[];
  },
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const indexFile = yield* Effect.acquireRelease(
        changeIo(async () => {
          const copy = `${index}.snapshot-${randomUUID()}`;
          await copyIndex(index, copy);
          return copy;
        }),
        (copy) =>
          Effect.promise(() =>
            Promise.all([
              rm(copy, { force: true }),
              rm(`${copy}.lock`, { force: true }),
            ]),
          ),
      );
      const update = (args: readonly string[], list: readonly string[]) =>
        list.length === 0
          ? Effect.void
          : runRepositoryGit(
              git,
              directory,
              ["update-index", ...args, "-z", "--stdin"],
              { indexFile, input: `${list.join("\0")}\0` },
            );
      const tree = runRepositoryGit(git, directory, ["write-tree"], {
        indexFile,
      }).pipe(Effect.map((oid) => oid.trim()));
      yield* update(["--force-remove"], conflicted);
      const staged = yield* tree;
      yield* update(["--add", "--remove"], paths);
      return { index: staged, worktree: yield* tree };
    }),
  );
}

export function restoreDiscarded(
  git: GitCommandRunner,
  directory: string,
  indexFile: string,
  { before, after }: DiscardedChanges,
) {
  return Effect.gen(function* () {
    const patch = (from: string, to: string) =>
      runRepositoryGit(git, directory, [
        "diff",
        ...patchOptions,
        "--no-renames",
        from,
        to,
        "--",
      ]);
    const apply = (args: readonly string[], input: string) =>
      input.trim() === ""
        ? Effect.void
        : runRepositoryGit(
            git,
            directory,
            ["apply", "--whitespace=nowarn", ...args],
            { indexFile, input },
          ).pipe(
            Effect.mapError(() =>
              changesFailed(
                "Conflict",
                "These files changed after the discard. Nothing was restored.",
              ),
            ),
          );
    yield* apply(["--cached"], yield* patch(after.index, before.index));
    yield* apply([], yield* patch(after.worktree, before.worktree));
  });
}
