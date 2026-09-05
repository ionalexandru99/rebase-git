import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import type { CommitLaneRow } from "#web/features/commit-graph/layout/commit-lanes";

const palette = [
  "#719cff",
  "#bb8af0",
  "#59c9a5",
  "#e7b65a",
  "#ee8297",
  "#63bada",
  "#de9568",
  "#a4be71",
] as const;

export function graphLaneColor(
  laneId: number,
  colors?: ReadonlyMap<number, string>,
) {
  return colors?.get(laneId) ?? palette[laneId % palette.length] ?? palette[0];
}

export function graphRefName(ref: RepositoryHistoryRefTarget) {
  return ref.type === "remote-branch"
    ? ref.name.slice(ref.name.indexOf("/") + 1)
    : ref.name;
}

export function graphBranchColorIndex(name: string) {
  if (name === "main" || name === "master") return 0;
  let hash = 0;
  for (const character of name)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 1 + (hash % (palette.length - 1));
}

export function graphColors(
  rows: readonly CommitLaneRow[],
  refs: readonly RepositoryHistoryRefTarget[],
) {
  const lanes = new Map<number, string>();
  const byOid = new Map<string, number>();
  for (const row of rows) {
    byOid.set(row.oid, row.nodeLaneId);
    for (const lane of row.lanesBefore)
      lanes.set(lane.id, graphLaneColor(lane.color));
    for (const lane of row.lanesAfter)
      lanes.set(lane.id, graphLaneColor(lane.color));
  }
  return {
    lanes,
    refs: new Map(
      refs
        .filter((ref) => ref.type === "branch" || ref.type === "remote-branch")
        .map((ref) => {
          const id = byOid.get(ref.oid);
          return [
            ref.name,
            id === undefined
              ? graphLaneColor(graphBranchColorIndex(graphRefName(ref)))
              : graphLaneColor(id, lanes),
          ];
        }),
    ),
  };
}
