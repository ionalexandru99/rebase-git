import type {
  HistoryAncestryIndex,
  HistoryAncestryRoute,
  HistoryParentEdge,
} from "#web/features/repository-history/history-order.contract";

export function findHistoryAncestryRoute(
  index: HistoryAncestryIndex,
  roots: readonly string[],
  targetOid: string,
): HistoryAncestryRoute | undefined {
  const target = index.positions.get(targetOid);
  if (target === undefined) return undefined;
  const costs = new Uint32Array(index.oids.length).fill(0xffffffff);
  const predecessors = new Int32Array(index.oids.length).fill(-1);
  const secondary = new Uint8Array(index.oids.length);
  const visited = new Uint8Array(index.oids.length);
  let pending = [...new Set(roots)].sort().flatMap((oid) => {
    const position = index.positions.get(oid);
    if (position === undefined) return [];
    costs[position] = 0;
    return [position];
  });
  while (pending.length > 0) {
    const next: number[] = [];
    while (pending.length > 0) {
      const child = pending.pop();
      if (child === undefined || visited[child]) continue;
      if (child === target)
        return collectRoute(index.oids, predecessors, secondary, target);
      visited[child] = 1;
      const start = index.offsets[child] ?? 0;
      const end = index.offsets[child + 1] ?? 0;
      for (let offset = start; offset < end; offset += 1) {
        const parent = index.parents[offset];
        if (parent === undefined || parent === 0xffffffff || visited[parent])
          continue;
        const isSecondary = offset === start ? 0 : 1;
        const cost = (costs[child] ?? 0) + isSecondary;
        if (cost >= (costs[parent] ?? 0xffffffff)) continue;
        costs[parent] = cost;
        predecessors[parent] = child;
        secondary[parent] = isSecondary;
        (isSecondary === 0 ? pending : next).push(parent);
      }
    }
    pending = next;
  }
  return undefined;
}

function collectRoute(
  oids: readonly string[],
  predecessors: Int32Array,
  secondary: Uint8Array,
  target: number,
): HistoryAncestryRoute {
  const reversed: HistoryParentEdge[] = [];
  let parent = target;
  let child = predecessors[parent] ?? -1;
  while (child >= 0) {
    const childOid = oids[child];
    const parentOid = oids[parent];
    if (secondary[parent] && childOid !== undefined && parentOid !== undefined)
      reversed.push({ childOid, parentOid });
    parent = child;
    child = predecessors[parent] ?? -1;
  }
  const edges = reversed.reverse().slice(0, 1_000);
  const continuationOid =
    reversed.length > edges.length ? edges.at(-1)?.parentOid : undefined;
  return {
    edges,
    ...(continuationOid === undefined ? {} : { continuationOid }),
  };
}
