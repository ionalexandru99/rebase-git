import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReadChangeDiff } from "@rebase/contracts";
import { Effect } from "effect";
import type {
  GitCommandOptions,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import { previewByteLimit } from "#server/domain/repository-comparison.contract";
import { changeIo } from "#server/features/repository-changes/git/change-failures";
import {
  safeChangePath,
  worktreeFile,
} from "#server/features/repository-changes/git/change-files";
import { runRepositoryGit } from "#server/repository/access/index";
import {
  binary,
  buildChangeDiff,
  objectFile,
} from "#server/repository/comparison/index";

export function readChangeDiff(
  git: GitCommandRunner,
  command: ReadChangeDiff,
  base: string,
  index: GitCommandOptions = {},
) {
  return Effect.gen(function* () {
    yield* safeChangePath(command.worktreePath, command.path);
    const [before, working] = yield* Effect.all(
      [
        objectFile(
          git,
          command.worktreePath,
          command.path,
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
    return buildChangeDiff(command.path, base, before, after);
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
      const objectDirectory = yield* scratchObjectDirectory;
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

const scratchObjectDirectory = Effect.acquireRelease(
  changeIo(() => mkdtemp(join(tmpdir(), "rebase-objects-"))),
  (path) =>
    changeIo(() => rm(path, { recursive: true, force: true })).pipe(
      Effect.ignore,
    ),
);
