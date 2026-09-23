import type { ChangeDiff } from "@rebase/contracts";
import { createTwoFilesPatch } from "diff";
import {
  previewByteLimit,
  type RepositoryFileContent,
} from "#server/domain/repository-comparison.contract";
import { fingerprint } from "#server/features/repository-comparison/fingerprint";

export function buildChangeDiff(
  path: string,
  base: string,
  before: RepositoryFileContent,
  after: RepositoryFileContent,
  previousPath = path,
): ChangeDiff {
  const mime = imageMime(path);
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
    path: path,
    kind,
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
            JSON.stringify(previousPath),
            JSON.stringify(path),
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
}

export function binary(content: Buffer | null) {
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
