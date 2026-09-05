import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import type {
  CommitLaneRow,
  CommitLaneSeed,
} from "#web/features/commit-graph/layout/commit-lanes.contract";

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
  if (["main", "master", "dev", "develop"].includes(name)) return 0;
  let hash = 0;
  for (const character of name)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 1 + (hash % (palette.length - 1));
}

export function graphLaneSeeds(
  refs: readonly RepositoryHistoryRefTarget[],
  previousRows: readonly CommitLaneRow[] = [],
) {
  const seeds = new Map<string, CommitLaneSeed>();
  for (const ref of refs) {
    if (ref.type !== "branch" && ref.type !== "remote-branch") continue;
    if (seeds.get(ref.oid)?.remote === false) continue;
    seeds.set(ref.oid, {
      color: graphBranchColorIndex(graphRefName(ref)),
      remote: ref.type === "remote-branch",
    });
  }
  for (const row of previousRows) {
    const node = row.lanesBefore.find((lane) => lane.id === row.nodeLaneId);
    if (node !== undefined)
      seeds.set(row.oid, {
        color: node.color,
        remote: seeds.get(row.oid)?.remote ?? row.nodeRemote,
      });
  }
  return seeds;
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
