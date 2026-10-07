import type { CommitLaneRow } from "#web/features/repository-history/commit-lanes.ts";

export const graphRowHeight = 26;
export const graphHeaderHeight = 28;
const graphLanePitch = 16;
const graphLaneInset = 16;
const graphSubjectMinimumWidth = 221;
export const graphMetadataColumns = "var(--graph-metadata-columns)";
export const graphMetadataWidth = "var(--graph-metadata-width)";
export const graphMetadataClassName =
  "[--graph-metadata-columns:150px_76px_76px] [--graph-metadata-width:302px] @max-[760px]/graph:[--graph-metadata-columns:150px_76px] @max-[760px]/graph:[--graph-metadata-width:226px] @max-[600px]/graph:[--graph-metadata-columns:40px_76px] @max-[600px]/graph:[--graph-metadata-width:116px]";
export const graphAuthorCellClassName =
  "sticky right-[152px] @max-[760px]/graph:right-[76px]";
export const graphAuthorNameClassName = "@max-[600px]/graph:sr-only";
export const graphShaCellClassName =
  "sticky right-[76px] @max-[760px]/graph:hidden";

export function graphMinimumWidth(gutterWidth: number) {
  return `calc(${gutterWidth + graphSubjectMinimumWidth}px + ${graphMetadataWidth})`;
}

export function graphLaneX(slot: number) {
  return graphLaneInset + slot * graphLanePitch;
}

export function commitGraphGutterWidth(rows: readonly CommitLaneRow[]) {
  let maximum = 0;
  for (const row of rows) {
    for (const lane of row.lanesBefore) maximum = Math.max(maximum, lane.slot);
    for (const lane of row.lanesAfter) maximum = Math.max(maximum, lane.slot);
  }
  return graphLaneX(maximum) + 12;
}

export function commitGraphNodePosition(row: CommitLaneRow) {
  return graphLaneX(
    row.lanesBefore.find((lane) => lane.id === row.nodeLaneId)?.slot ?? 0,
  );
}
