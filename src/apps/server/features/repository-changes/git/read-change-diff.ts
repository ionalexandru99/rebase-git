import type {
  ChangeDiff,
  ReadChangeDiff,
} from "@rebase/contracts/repository-changes/repository-changes.contract";
import { createTwoFilesPatch } from "diff";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import {
  objectFile,
  previewByteLimit,
  safeChangePath,
  worktreeFile,
} from "#server/features/repository-changes/git/change-files";
import {
  changeGit,
  fingerprint,
} from "#server/features/repository-changes/git/change-git";

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
    const mime = imageMime(command.path);
    const kind: ChangeDiff["kind"] =
      before.mode === "conflict" || after.mode === "conflict"
        ? "conflict"
        : before.mode === "160000" || after.mode === "160000"
          ? "submodule"
          : before.bytes > previewByteLimit || after.bytes > previewByteLimit
            ? "large"
            : before.mode === "120000" || after.mode === "120000"
              ? "symlink"
              : mime !== null
                ? "image"
                : binary(before.content) || binary(after.content)
                  ? "binary"
                  : "text";
    const oldText = before.content?.toString("utf8") ?? "";
    const newText = after.content?.toString("utf8") ?? "";
    const diff: ChangeDiff = {
      path: command.path,
      kind,
      mime,
      revision: fingerprint(
        base,
        before.identity,
        after.identity,
        before.content ?? "",
        after.content ?? "",
      ),
      beforeBytes: before.bytes,
      afterBytes: after.bytes,
      before:
        before.content === null
          ? null
          : kind === "image"
            ? before.content.toString("base64")
            : kind === "text"
              ? oldText
              : null,
      after:
        after.content === null
          ? null
          : kind === "image"
            ? after.content.toString("base64")
            : kind === "text"
              ? newText
              : null,
      patch:
        kind === "text"
          ? createTwoFilesPatch(
              JSON.stringify(command.path),
              JSON.stringify(command.path),
              oldText,
              newText,
              "",
              "",
              { context: 3 },
            )
          : "",
    };
    if (Buffer.byteLength(JSON.stringify(diff)) > 900_000)
      return {
        ...diff,
        kind: "large" as const,
        before: null,
        after: null,
        patch: "",
      };
    return diff;
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

function binary(content: Buffer | null) {
  return (
    content !== null &&
    (content.includes(0) ||
      !Buffer.from(content.toString("utf8")).equals(content))
  );
}
function imageMime(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    ico: "image/x-icon",
  };
  return types[extension ?? ""] ?? null;
}
