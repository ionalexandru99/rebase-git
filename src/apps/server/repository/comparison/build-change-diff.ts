import { isUtf8 } from "node:buffer";
import { createTwoFilesPatch } from "diff";
import type { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";
import { fingerprint } from "#server/repository/comparison/fingerprint.ts";
import {
  diffByteLimit,
  previewByteLimit,
} from "#server/repository/comparison/read-blobs.ts";
import type { RepositoryFileContent } from "#server/repository/comparison/read-object-file.ts";

const patchTimeoutMilliseconds = 250;

export interface ChangeDiffSource {
  readonly previousPath?: string;
  readonly patch?: string | undefined;
  readonly whole?: boolean | undefined;
}

export function buildChangeDiff(
  path: string,
  base: string,
  before: RepositoryFileContent,
  after: RepositoryFileContent,
  { previousPath = path, patch, whole = false }: ChangeDiffSource = {},
): ChangeDiff {
  const mime = imageMime(path);
  const largeFile = before.largeFile ?? after.largeFile;
  const kind: ChangeDiff["kind"] =
    before.mode === "conflict" || after.mode === "conflict"
      ? "conflict"
      : before.mode === "160000" || after.mode === "160000"
        ? "submodule"
        : before.largeFile === "missing" || after.largeFile === "missing"
          ? "missing"
          : before.bytes > diffByteLimit || after.bytes > diffByteLimit
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
  const textPatch =
    kind === "text"
      ? ((largeFile === undefined ? patch : undefined) ??
        boundedPatch(previousPath, path, oldText, newText))
      : "";
  const partial =
    kind === "text" &&
    !whole &&
    (before.bytes > previewByteLimit || after.bytes > previewByteLimit);
  const diff: ChangeDiff = {
    path: path,
    kind: partial ? "partial" : kind,
    mime,
    revision: fingerprint(
      base,
      path,
      previousPath,
      before.identity,
      after.identity,
      before.content ?? "",
      after.content ?? "",
    ),
    beforeBytes: before.bytes,
    afterBytes: after.bytes,
    before:
      before.content === null || partial
        ? null
        : kind === "image"
          ? before.content.toString("base64")
          : kind === "text"
            ? oldText
            : null,
    after:
      after.content === null || partial
        ? null
        : kind === "image"
          ? after.content.toString("base64")
          : kind === "text"
            ? newText
            : null,
    patch: textPatch ?? "",
    ...(kind === "missing"
      ? {
          largeFileCommits: [before, after].flatMap((side) =>
            side.largeFile === "missing" && side.largeFileCommit !== undefined
              ? [side.largeFileCommit]
              : [],
          ),
        }
      : {}),
  };
  if (
    textPatch === undefined ||
    (!whole && Buffer.byteLength(JSON.stringify(diff)) > 900_000)
  )
    return {
      ...diff,
      kind: "large" as const,
      before: null,
      after: null,
      patch: "",
    };
  return diff;
}

function boundedPatch(
  previousPath: string,
  path: string,
  oldText: string,
  newText: string,
) {
  return createTwoFilesPatch(previousPath, path, oldText, newText, "", "", {
    context: 3,
    timeout: patchTimeoutMilliseconds,
  });
}

export function binary(content: Buffer | null) {
  return content !== null && (content.includes(0) || !isUtf8(content));
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
