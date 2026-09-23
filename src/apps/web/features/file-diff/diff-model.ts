import {
  type FileDiffMetadata,
  getFiletypeFromFileName,
  processFile,
} from "@pierre/diffs";
import type { ChangeDiff } from "@rebase/contracts";

export function createChangeDiffModel(
  diff: Pick<
    ChangeDiff,
    "kind" | "patch" | "path" | "revision" | "before" | "after"
  > | null,
) {
  const metadata =
    diff?.kind === "text"
      ? processFile(diff.patch, {
          cacheKey: diff.revision,
          oldFile: { name: diff.path, contents: diff.before ?? "" },
          newFile: { name: diff.path, contents: diff.after ?? "" },
          throwOnError: false,
        })
      : undefined;
  if (metadata && diff) {
    metadata.name = diff.path;
    delete metadata.prevName;
    metadata.lang = getFiletypeFromFileName(diff.path);
    metadata.type =
      diff.before === null ? "new" : diff.after === null ? "deleted" : "change";
  }
  return { metadata, hasHiddenContext: hasHiddenContext(metadata) };
}

function hasHiddenContext(metadata: FileDiffMetadata | undefined) {
  if (!metadata || metadata.isPartial) return false;
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
