import { getFiletypeFromFileName, processFile } from "@pierre/diffs";
import type { ChangeDiff } from "@rebase/contracts/repository-changes/repository-changes.contract";

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
  return { metadata };
}
