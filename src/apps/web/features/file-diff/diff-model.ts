import {
  type FileDiffMetadata,
  getFiletypeFromFileName,
  processFile,
} from "@pierre/diffs";
import type { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";

type ModelDiff = Pick<
  ChangeDiff,
  | "kind"
  | "patch"
  | "path"
  | "revision"
  | "before"
  | "after"
  | "beforeBytes"
  | "afterBytes"
>;

export function contentUnchanged(diff: ModelDiff) {
  return diff.kind === "partial"
    ? !/^@@ /m.test(diff.patch)
    : diff.kind === "text" && diff.before === diff.after;
}

export function createChangeDiffModel(
  diff: ModelDiff | null,
  previousPath: string | null = null,
) {
  const metadata =
    diff?.kind === "text"
      ? processFile(diff.patch, {
          cacheKey: diff.revision,
          oldFile: { name: diff.path, contents: diff.before ?? "" },
          newFile: { name: diff.path, contents: diff.after ?? "" },
          throwOnError: false,
        })
      : diff?.kind === "partial"
        ? processFile(diff.patch, {
            cacheKey: `${diff.revision}:partial`,
            throwOnError: false,
          })
        : undefined;
  if (metadata && diff) {
    metadata.name = diff.path;
    delete metadata.prevName;
    metadata.lang = getFiletypeFromFileName(diff.path);
    if (diff.kind === "text")
      metadata.type =
        diff.before === null
          ? "new"
          : diff.after === null
            ? "deleted"
            : "change";
    if (previousPath !== null && previousPath !== diff.path) {
      metadata.prevName = previousPath;
      metadata.type = "rename-changed";
    }
  }
  return {
    metadata,
    hasHiddenContext:
      diff?.kind === "partial"
        ? diff.beforeBytes > 0 &&
          diff.afterBytes > 0 &&
          (metadata?.hunks.length ?? 0) > 0
        : hasHiddenContext(metadata),
  };
}

function hasHiddenContext(metadata: FileDiffMetadata | undefined) {
  if (!metadata) return false;
  if (metadata.hunks.some((hunk) => hunk.collapsedBefore > 1)) return true;
  const last = metadata.hunks.at(-1);
  if (
    !last ||
    metadata.additionLines.length === 0 ||
    metadata.deletionLines.length === 0
  )
    return false;
  return (
    metadata.additionLines.length -
      (last.additionLineIndex + last.additionCount) >
    1
  );
}
