import type { CommitLaneRow } from "#web/features/commit-graph/layout/commit-lanes.contract";
import {
  graphLaneInset,
  graphLanePitch,
} from "#web/features/commit-graph/layout/graph-metrics";

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
