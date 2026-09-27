import type { CommitLaneRow } from "#web/features/repository-history/commit-lanes.ts";

export const graphRowHeight = 26;
export const graphHeaderHeight = 28;
const graphLanePitch = 16;
const graphLaneInset = 16;
const metadataColumnWidths = [149, 78, 112] as const;
export const graphMetadataColumns = metadataColumnWidths
  .map((width) => `${width}px`)
  .join(" ");
export const graphMetadataWidth = metadataColumnWidths.reduce<number>(
  (total, width) => total + width,
  0,
);

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
