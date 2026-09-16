import type { ReadChangeDiff } from "@rebase/contracts/repository-changes/repository-changes.contract";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import {
  binary,
  buildChangeDiff,
} from "#server/features/repository-changes/git/build-change-diff";
import {
  objectFile,
  previewByteLimit,
  safeChangePath,
  worktreeFile,
} from "#server/features/repository-changes/git/change-files";
import { changeGit } from "#server/features/repository-changes/git/change-git";

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
  });
}

function cleanFileContent(
  git: GitCommandRunner,
  directory: string,
  path: string,
  content: Buffer,
) {
  return Effect.gen(function* () {
    const oid = (yield* changeGit(
      git,
      directory,
      ["hash-object", "-w", `--path=${path}`, "--stdin"],
      { input: content.toString("utf8") },
    )).trim();
    return Buffer.from(
      yield* changeGit(git, directory, ["cat-file", "blob", oid], {
        outputEncoding: "base64",
        maxOutputBytes: previewByteLimit,
      }),
      "base64",
    );
  });
}
