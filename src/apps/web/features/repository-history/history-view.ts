import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import {
  appendCommitLanes,
  type CommitLaneCheckpoint,
  type CommitLaneRow,
  type CommitLaneSeed,
  createCommitLaneCheckpoint,
  graphLaneSeeds,
} from "#web/features/repository-history/commit-lanes";
import type {
  HistoryGraph,
  HistoryOrder,
  HistoryParentEdge,
} from "#web/features/repository-history/history-graph";

export interface HistoryScopeQuery {
  readonly roots: readonly RepositoryHistoryRefTarget[];
  readonly order: HistoryOrder;
  readonly expanded: readonly HistoryParentEdge[];
}

export interface HistoryTarget {
  readonly index: number;
  readonly expanded: readonly HistoryParentEdge[];
  readonly root?: RepositoryHistoryRefTarget;
}

export interface HistoryViewRow {
  readonly oid: string;
  readonly lane: CommitLaneRow;
  readonly merge?: "collapsed" | "expanded";
}

const checkpointRows = 256;

export class HistoryView {
  readonly total: number;
  private readonly order: Int32Array;
  private readonly rowOf: Int32Array;
  private readonly allowed: ReadonlySet<string>;
  private readonly local: Uint8Array | undefined;
  private readonly seeds: ReadonlyMap<string, CommitLaneSeed>;
  private checkpoints: CommitLaneCheckpoint[] = [createCommitLaneCheckpoint()];

  constructor(
    private readonly graph: HistoryGraph,
    query: HistoryScopeQuery,
    refTargets: readonly RepositoryHistoryRefTarget[],
    previous?: HistoryView,
  ) {
    const resolved = query.roots.map(
      (root) => graph.id(root.oid) ?? fallbackRoot(graph, root, refTargets),
    );
    const roots = resolved.filter((id): id is number => id !== undefined);
    this.allowed = new Set(
      query.expanded.map(
        ({ childOid, parentOid }) => `${childOid}\0${parentOid}`,
      ),
    );
    const allowed = expandedParents(graph, query.expanded);
    const reachable = graph.reachable(
      roots,
      (child, slot, parent) =>
        slot === 0 || allowed.get(child)?.has(parent) === true,
    );
    this.order = graph.order(reachable, query.order);
    this.total = this.order.length;
    this.rowOf = new Int32Array(graph.size).fill(-1);
    this.order.forEach((id, row) => {
      this.rowOf[id] = row;
    });
    const localRoots = resolved.filter(
      (id, index): id is number =>
        id !== undefined &&
        (query.roots[index]?.type === "branch" ||
          query.roots[index]?.type === "head"),
    );
    this.local = query.roots.every(
      (root) => root.type === "branch" || root.type === "head",
    )
      ? undefined
      : graph.reachable(localRoots, () => true);
    this.seeds = graphLaneSeeds(
      [...query.roots, ...refTargets],
      [],
      query.roots,
    );
    if (previous !== undefined && this.extends(previous))
      this.checkpoints = [...previous.checkpoints];
  }

  row(oid: string) {
    const id = this.graph.id(oid);
    const row = id === undefined ? -1 : (this.rowOf[id] ?? -1);
    return row < 0 ? undefined : row;
  }

  oids(start: number, end: number) {
    return Array.from(this.order.subarray(start, end), (id) =>
      this.graph.oid(id),
    );
  }

  rows(start: number, end: number): HistoryViewRow[] {
    const last = Math.min(end, this.total);
    if (start >= last) return [];
    let checkpointIndex = Math.min(
      Math.floor(start / checkpointRows),
      this.checkpoints.length - 1,
    );
    let checkpoint =
      this.checkpoints[checkpointIndex] ?? createCommitLaneCheckpoint();
    const result: HistoryViewRow[] = [];
    for (
      let chunk = checkpointIndex * checkpointRows;
      chunk < last;
      chunk += checkpointRows
    ) {
      const chunkEnd = Math.min(chunk + checkpointRows, this.total);
      const lanes = appendCommitLanes(
        checkpoint,
        this.topology(chunk, chunkEnd),
        this.seeds,
        this.local === undefined
          ? undefined
          : { has: (oid) => this.isLocal(oid) },
      );
      checkpointIndex += 1;
      if (chunkEnd === chunk + checkpointRows)
        this.checkpoints[checkpointIndex] ??= lanes.checkpoint;
      checkpoint = lanes.checkpoint;
      lanes.rows.forEach((lane, offset) => {
        const row = chunk + offset;
        if (row < start || row >= last) return;
        const merge = this.merge(this.order[row] ?? -1);
        result.push(
          merge === undefined
            ? { oid: lane.oid, lane }
            : { oid: lane.oid, lane, merge },
        );
      });
    }
    return result;
  }

  private extends(previous: HistoryView) {
    const rows = (previous.checkpoints.length - 1) * checkpointRows;
    if (previous.graph !== this.graph || rows > this.total) return false;
    for (let row = 0; row < rows; row += 1) {
      const id = this.order[row] ?? -1;
      if (
        id !== previous.order[row] ||
        this.local?.[id] !== previous.local?.[id]
      )
        return false;
      const parents = this.graph.parentIds(id);
      for (let slot = 1; slot < parents.length; slot += 1) {
        const parent = parents[slot] ?? -1;
        if (
          (this.rowOf[parent] ?? -1) >= 0 !==
          (previous.rowOf[parent] ?? -1) >= 0
        )
          return false;
      }
    }
    return true;
  }

  private topology(start: number, end: number) {
    return Array.from(this.order.subarray(start, end), (id) => {
      const oid = this.graph.oid(id);
      const parentIds = this.graph.parentIds(id);
      return {
        oid,
        parents: this.graph
          .parentOids(id)
          .filter(
            (parent, slot) =>
              slot === 0 ||
              (this.rowOf[parentIds[slot] ?? -1] ?? -1) >= 0 ||
              this.allowed.has(`${oid}\0${parent}`),
          ),
      };
    });
  }

  private merge(id: number) {
    const parents = this.graph.parentIds(id);
    if (parents.length < 2) return undefined;
    const oid = this.graph.oid(id);
    const secondary = this.graph.parentOids(id).slice(1);
    if (secondary.some((parent) => this.allowed.has(`${oid}\0${parent}`)))
      return "expanded" as const;
    return parents
      .slice(1)
      .some((parent) => parent < 0 || (this.rowOf[parent] ?? -1) < 0)
      ? ("collapsed" as const)
      : undefined;
  }

  private isLocal(oid: string) {
    const id = this.graph.id(oid);
    return id !== undefined && this.local?.[id] === 1;
  }
}

function expandedParents(
  graph: HistoryGraph,
  expanded: readonly HistoryParentEdge[],
) {
  const parents = new Map<number, Set<number>>();
  for (const { childOid, parentOid } of expanded) {
    const child = graph.id(childOid);
    const parent = graph.id(parentOid);
    if (child === undefined || parent === undefined) continue;
    const known = parents.get(child) ?? new Set<number>();
    known.add(parent);
    parents.set(child, known);
  }
  return parents;
}

function fallbackRoot(
  graph: HistoryGraph,
  root: RepositoryHistoryRefTarget,
  refTargets: readonly RepositoryHistoryRefTarget[],
) {
  const known = refTargets.find(
    (ref) => ref.type === root.type && ref.name === root.name,
  );
  return known === undefined ? undefined : graph.id(known.oid);
}

export function findInHistory(
  graph: HistoryGraph,
  refTargets: readonly RepositoryHistoryRefTarget[],
  scope: HistoryScopeQuery,
  oid: string,
  view: (scope: HistoryScopeQuery) => HistoryView,
): HistoryTarget | undefined {
  const row = view(scope).row(oid);
  if (row !== undefined) return { index: row, expanded: [] };
  const target = graph.id(oid);
  if (target === undefined) return undefined;
  const roots = scope.roots.flatMap((root) => {
    const id = graph.id(root.oid);
    return id === undefined ? [] : [id];
  });
  const direct = graph.ancestryRoute(roots, target);
  const root =
    direct === undefined
      ? containingRef(graph, refTargets, scope, target)
      : undefined;
  const route =
    direct ??
    (root === undefined
      ? undefined
      : graph.ancestryRoute([...roots, graph.id(root.oid) ?? -1], target));
  if (route === undefined) return undefined;
  const index = view({
    ...scope,
    roots: root === undefined ? scope.roots : [...scope.roots, root],
    expanded: [...scope.expanded, ...route.edges],
  }).row(oid);
  if (index === undefined) return undefined;
  return root === undefined
    ? { index, expanded: route.edges }
    : { index, expanded: route.edges, root };
}

function containingRef(
  graph: HistoryGraph,
  refTargets: readonly RepositoryHistoryRefTarget[],
  scope: HistoryScopeQuery,
  target: number,
) {
  for (const type of ["branch", "remote-branch", "tag"] as const) {
    const candidates = refTargets
      .filter((ref) => ref.type === type && graph.has(ref.oid))
      .sort((left, right) => left.name.localeCompare(right.name));
    const route = graph.ancestryRoute(
      candidates.map((ref) => graph.id(ref.oid) ?? -1),
      target,
    );
    if (route === undefined) continue;
    const root = candidates.find((ref) => graph.id(ref.oid) === route.root);
    return root === undefined ||
      scope.roots.some(
        (current) => current.type === root.type && current.name === root.name,
      )
      ? undefined
      : root;
  }
  return undefined;
}
