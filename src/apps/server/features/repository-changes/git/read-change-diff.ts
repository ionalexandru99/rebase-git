import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { ReadChangeDiff } from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  type GitCommandOptions,
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { changeIo } from "#server/features/repository-changes/git/change-failures.ts";
import {
  safeChangePath,
  worktreeFile,
} from "#server/features/repository-changes/git/change-files.ts";
import {
  binary,
  buildChangeDiff,
} from "#server/repository/comparison/build-change-diff.ts";
import { previewByteLimit } from "#server/repository/comparison/read-blobs.ts";
import { objectFile } from "#server/repository/comparison/read-object-file.ts";

export function readChangeDiff(
  git: GitCommandRunner,
  command: ReadChangeDiff,
  { base, previousPath }: { base: string; previousPath: string | null },
  index: GitCommandOptions = {},
) {
  return Effect.gen(function* () {
    yield* safeChangePath(command.worktreePath, command.path);
    const [before, working] = yield* Effect.all(
      [
        objectFile(
          git,
          command.worktreePath,
          previousPath ?? command.path,
          command.section === "staged" ? { ...index, tree: base } : index,
        ),
        command.section === "staged"
          ? objectFile(git, command.worktreePath, command.path, index)
          : worktreeFile(command.worktreePath, command.path),
      ],
      { concurrency: 2 },
    );
    const after =
      command.section === "unstaged" &&
      working.mode.startsWith("100") &&
      working.content !== null &&
      !binary(working.content)
        ? {
            ...working,
            content: yield* cleanFileContent(
              git,
              index,
              command.worktreePath,
              command.path,
              working.content,
            ),
          }
        : working;
    return buildChangeDiff(command.path, base, before, after, {
      previousPath: previousPath ?? command.path,
    });
  });
}

function cleanFileContent(
  git: GitCommandRunner,
  index: GitCommandOptions,
  directory: string,
  path: string,
  content: Buffer,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const objectDirectory = yield* scratchDirectory;
      const oid = (yield* runRepositoryGit(
        git,
        directory,
        ["hash-object", "-w", `--path=${path}`, "--stdin"],
        { ...index, input: content.toString("utf8"), objectDirectory },
      )).trim();
      return Buffer.from(
        yield* runRepositoryGit(git, directory, ["cat-file", "blob", oid], {
          ...index,
          objectDirectory,
          outputEncoding: "base64",
          maxOutputBytes: previewByteLimit,
        }),
        "base64",
      );
    }),
  );
}

export const scratchDirectory = Effect.acquireRelease(
  changeIo(() => mkdtemp(join(tmpdir(), "rebase-scratch-"))),
  (path) =>
    changeIo(() => rm(path, { recursive: true, force: true })).pipe(
      Effect.ignore,
    ),
);
