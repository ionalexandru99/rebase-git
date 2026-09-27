import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import {
  type CommitLaneRow,
  graphBranchColorIndex,
  graphRefName,
  laneColorCount,
} from "#web/features/repository-history/commit-lanes";

export const graphRemoteOpacity = 0.5;

const palette = [
  "#4C9AFF",
  "#22C55E",
  "#B38AFF",
  "#F97316",
  "#84CC16",
  "#06B6D4",
  "#EF4444",
  "#F59E0B",
] as const;

export function graphLaneColor(color: number) {
  return palette[color % laneColorCount] ?? palette[0];
}

export function graphNodeColor(row: CommitLaneRow) {
  return graphLaneColor(
    row.lanesBefore.find((lane) => lane.id === row.nodeLaneId)?.color ?? 0,
  );
}

export function graphColors(
  rows: readonly CommitLaneRow[],
  refs: readonly RepositoryHistoryRefTarget[],
  previousRefs?: ReadonlyMap<string, string>,
) {
  const nodes = new Map(rows.map((row) => [row.oid, graphNodeColor(row)]));
  return {
    nodes,
    refs: new Map(
      refs
        .filter((ref) => ref.type === "branch" || ref.type === "remote-branch")
        .map((ref) => {
          return [
            ref.name,
            nodes.get(ref.oid) ??
              previousRefs?.get(ref.name) ??
              graphLaneColor(graphBranchColorIndex(graphRefName(ref))),
          ];
        }),
    ),
  };
}
