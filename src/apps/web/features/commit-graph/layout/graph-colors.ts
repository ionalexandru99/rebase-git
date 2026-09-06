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

export function graphLaneColor(color: number) {
  return palette[color % palette.length] ?? palette[0];
}

export function graphNodeColor(row: CommitLaneRow) {
  return graphLaneColor(
    row.lanesBefore.find((lane) => lane.id === row.nodeLaneId)?.color ?? 0,
  );
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
  roots: readonly RepositoryHistoryRefTarget[] = [],
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
        remote: seeds.get(row.oid)?.remote === false ? false : row.nodeRemote,
      });
  }
  const selectedRefs = new Set(roots.map((ref) => `${ref.type}\0${ref.name}`));
  for (const ref of refs) {
    if (ref.type !== "branch" && ref.type !== "remote-branch") continue;
    if (!selectedRefs.has(`${ref.type}\0${ref.name}`)) continue;
    const seed = seeds.get(ref.oid);
    if (seed?.boundary) continue;
    seeds.set(ref.oid, {
      color: graphBranchColorIndex(graphRefName(ref)),
      remote: seed?.remote ?? ref.type === "remote-branch",
      boundary: true,
    });
  }
  return seeds;
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
