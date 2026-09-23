import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReadChangeDiff } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { previewByteLimit } from "#server/domain/repository-comparison.contract";
import {
  safeChangePath,
  worktreeFile,
} from "#server/features/repository-changes/git/change-files";
import {
  changeGit,
  changeIo,
  changesError,
} from "#server/features/repository-changes/git/change-git";
import {
  binary,
  buildChangeDiff,
  objectFile,
} from "#server/repository/comparison/index";

export function readChangeDiff(
  git: GitCommandRunner,
  command: ReadChangeDiff,
  base: string,
) {
  return Effect.gen(function* () {
    yield* safeChangePath(command.worktreePath, command.path);
    const [before, working] = yield* Effect.all(
      [
        objectFile(
          git,
          command.worktreePath,
          command.path,
          command.section === "staged" ? base : undefined,
        ),
        command.section === "staged"
          ? objectFile(git, command.worktreePath, command.path)
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
              command.worktreePath,
              command.path,
              working.content,
            ),
          }
        : working;
    return buildChangeDiff(command.path, base, before, after);
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "RepositoryGitError"
        ? changesError("GitFailed", error.detail)
        : error,
    ),
  );
}

function cleanFileContent(
  git: GitCommandRunner,
  directory: string,
  path: string,
  content: Buffer,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const objectDirectory = yield* scratchObjectDirectory;
      const oid = (yield* changeGit(
        git,
        directory,
        ["hash-object", "-w", `--path=${path}`, "--stdin"],
        { input: content.toString("utf8"), objectDirectory },
      )).trim();
      return Buffer.from(
        yield* changeGit(git, directory, ["cat-file", "blob", oid], {
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
