import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
export function selectedDiffLines(
  diff: FileDiffMetadata,
  range: SelectedLineRange | null,
) {
  if (range === null) return [];
  const side = range.side ?? "additions";
  const endSide = range.endSide ?? side;
  const rows = diff.hunks.flatMap((hunk) =>
    hunk.hunkContent.flatMap((content) =>
      content.type === "change"
        ? [
            ...Array.from({ length: content.deletions }, (_, i) => ({
              old: content.deletionLineIndex + i + 1,
              next: 0,
              id: `-${content.deletionLineIndex + i + 1}`,
            })),
            ...Array.from({ length: content.additions }, (_, i) => ({
              old: 0,
              next: content.additionLineIndex + i + 1,
              id: `+${content.additionLineIndex + i + 1}`,
            })),
          ]
        : Array.from({ length: content.lines }, (_, i) => ({
            old: content.deletionLineIndex + i + 1,
            next: content.additionLineIndex + i + 1,
            id: "",
          })),
    ),
  );
  if (side === endSide)
    return rows
      .filter(
        (row) =>
          row.id &&
          (side === "deletions" ? row.old : row.next) >=
            Math.min(range.start, range.end) &&
          (side === "deletions" ? row.old : row.next) <=
            Math.max(range.start, range.end),
      )
      .map((row) => row.id);
  const start = rows.findIndex(
    (row) => (side === "deletions" ? row.old : row.next) === range.start,
  );
  const end = rows.findIndex(
    (row) => (endSide === "deletions" ? row.old : row.next) === range.end,
  );
  return start < 0 || end < 0
    ? []
    : rows
        .slice(Math.min(start, end), Math.max(start, end) + 1)
        .flatMap((row) => (row.id ? [row.id] : []));
}
