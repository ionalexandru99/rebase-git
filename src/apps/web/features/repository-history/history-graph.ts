import type {
  GraphCommit,
  StoredTopology,
} from "#web/features/repository-history/history-database";

export type HistoryOrder = "topological" | "chronological";

export interface HistoryParentEdge {
  readonly childOid: string;
  readonly parentOid: string;
}

export class HistoryGraph {
  private readonly ids = new Map<string, number>();
  private readonly oids: string[] = [];
  private readonly parents: number[][] = [];
  private readonly timestamps: number[] = [];
  private readonly ranks: number[] = [];
  private readonly waiting = new Map<string, number[]>();
  private readonly missing = new Map<string, string>();
  private sorted: number[] = [];
  private added: number[] = [];
  private reranked = false;
  private positions: Int32Array | undefined;

  static fromTopology(topology: StoredTopology) {
    const graph = new HistoryGraph();
    topology.oids.forEach((oid, index) => {
      graph.ids.set(oid, index);
      graph.oids.push(oid);
      graph.ranks.push(index);
      graph.timestamps.push(topology.timestamps[index] ?? 0);
      graph.parents.push(
        Array.from(
          topology.parents.subarray(
            topology.offsets[index],
            topology.offsets[index + 1],
          ),
        ),
      );
      graph.sorted.push(index);
    });
    for (const [slot, oid] of topology.missing) {
      const child = upperBound(topology.offsets, slot) - 1;
      graph.wait(oid, child, slot - (topology.offsets[child] ?? 0));
    }
    return graph;
  }

  get size() {
    return this.oids.length;
  }

  has(oid: string) {
    return this.ids.has(oid);
  }

  id(oid: string) {
    return this.ids.get(oid);
  }

  oid(id: number) {
    return this.oids[id] ?? "";
  }

  parentIds(id: number): readonly number[] {
    return this.parents[id] ?? [];
  }

  parentOids(id: number) {
    return this.parentIds(id).map((parent, slot) =>
      parent < 0 ? (this.missing.get(`${id}:${slot}`) ?? "") : this.oid(parent),
    );
  }

  add(commit: GraphCommit, rank: number) {
    const known = this.ids.get(commit.oid);
    if (known !== undefined) {
      if (this.ranks[known] !== rank) {
        this.ranks[known] = rank;
        this.reranked = true;
      }
      return;
    }
    const id = this.oids.length;
    this.ids.set(commit.oid, id);
    this.oids.push(commit.oid);
    this.ranks.push(rank);
    this.timestamps.push(commit.committer.timestampSeconds);
    this.parents.push(
      commit.parents.map((parent, slot) => {
        const parentId = this.ids.get(parent);
        if (parentId === undefined) this.wait(parent, id, slot);
        return parentId ?? -1;
      }),
    );
    const children = this.waiting.get(commit.oid);
    if (children !== undefined) {
      this.waiting.delete(commit.oid);
      for (let index = 0; index < children.length; index += 2) {
        const child = children[index] ?? -1;
        const slot = children[index + 1] ?? 0;
        const parents = this.parents[child];
        if (parents !== undefined) parents[slot] = id;
        this.missing.delete(`${child}:${slot}`);
      }
    }
    this.added.push(id);
  }

  topology(): StoredTopology {
    const sorted = this.ordered();
    const offsets = new Uint32Array(sorted.length + 1);
    const parents: number[] = [];
    const missing: (readonly [number, string])[] = [];
    const positions = this.positionsOf();
    sorted.forEach((id, index) => {
      offsets[index] = parents.length;
      for (const parent of this.parentIds(id))
        parents.push(parent < 0 ? -1 : (positions[parent] ?? -1));
    });
    offsets[sorted.length] = parents.length;
    for (const [oid, children] of this.waiting)
      for (let index = 0; index < children.length; index += 2)
        missing.push([
          (offsets[positions[children[index] ?? 0] ?? 0] ?? 0) +
            (children[index + 1] ?? 0),
          oid,
        ]);
    return {
      oids: sorted.map((id) => this.oid(id)),
      parents: Int32Array.from(parents),
      offsets,
      timestamps: Float64Array.from(sorted, (id) => this.timestamps[id] ?? 0),
      missing,
    };
  }

  reachable(
    roots: readonly number[],
    follow: (child: number, slot: number, parent: number) => boolean,
  ) {
    const seen = new Uint8Array(this.oids.length);
    const pending = [...roots];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (seen[id]) continue;
      seen[id] = 1;
      const parents = this.parents[id] ?? [];
      for (let slot = 0; slot < parents.length; slot += 1) {
        const parent = parents[slot] ?? -1;
        if (parent >= 0 && !seen[parent] && follow(id, slot, parent))
          pending.push(parent);
      }
    }
    return seen;
  }

  order(reachable: Uint8Array, order: HistoryOrder): Int32Array {
    return (
      (order === "topological" ? this.storedOrder(reachable) : undefined) ??
      this.sortedOrder(reachable, order)
    );
  }

  private storedOrder(reachable: Uint8Array) {
    const positions = this.positionsOf();
    const result: number[] = [];
    for (const id of this.ordered()) {
      if (!reachable[id]) continue;
      for (const parent of this.parentIds(id))
        if (
          parent >= 0 &&
          reachable[parent] &&
          (positions[parent] ?? 0) <= (positions[id] ?? 0)
        )
          return undefined;
      result.push(id);
    }
    return Int32Array.from(result);
  }

  private sortedOrder(reachable: Uint8Array, order: HistoryOrder) {
    const positions = this.positionsOf();
    const sorted = this.ordered();
    const children = new Uint32Array(this.oids.length);
    let count = 0;
    for (const id of sorted) {
      if (!reachable[id]) continue;
      count += 1;
      for (const parent of this.parentIds(id))
        if (parent >= 0 && reachable[parent])
          children[parent] = (children[parent] ?? 0) + 1;
    }
    const ready = new HistoryQueue((left, right) => {
      if (order === "chronological") {
        const difference =
          (this.timestamps[right] ?? 0) - (this.timestamps[left] ?? 0);
        if (difference !== 0) return difference;
      }
      return (positions[left] ?? 0) - (positions[right] ?? 0);
    });
    for (const id of sorted)
      if (reachable[id] && children[id] === 0) ready.push(id);
    const result = new Int32Array(count);
    let index = 0;
    for (let id = ready.pop(); id !== undefined; id = ready.pop()) {
      result[index] = id;
      index += 1;
      for (const parent of this.parentIds(id)) {
        if (parent < 0 || !reachable[parent]) continue;
        children[parent] = (children[parent] ?? 0) - 1;
        if (children[parent] === 0) ready.push(parent);
      }
    }
    if (index !== count) throw new Error("History topology is inconsistent");
    return result;
  }

  ancestryRoute(roots: readonly number[], target: number) {
    const costs = new Uint32Array(this.oids.length).fill(0xffffffff);
    const predecessors = new Int32Array(this.oids.length).fill(-1);
    const secondary = new Uint8Array(this.oids.length);
    const visited = new Uint8Array(this.oids.length);
    let pending = [...new Set(roots)];
    for (const root of pending) costs[root] = 0;
    while (pending.length > 0) {
      const next: number[] = [];
      while (pending.length > 0) {
        const child = pending.pop();
        if (child === undefined || visited[child]) continue;
        if (child === target)
          return this.route(predecessors, secondary, target);
        visited[child] = 1;
        this.parentIds(child).forEach((parent, slot) => {
          if (parent < 0 || visited[parent]) return;
          const cost = (costs[child] ?? 0) + (slot === 0 ? 0 : 1);
          if (cost >= (costs[parent] ?? 0xffffffff)) return;
          costs[parent] = cost;
          predecessors[parent] = child;
          secondary[parent] = slot === 0 ? 0 : 1;
          (slot === 0 ? pending : next).push(parent);
        });
      }
      pending = next;
    }
    return undefined;
  }

  private route(
    predecessors: Int32Array,
    secondary: Uint8Array,
    target: number,
  ) {
    const edges: HistoryParentEdge[] = [];
    let parent = target;
    let child = predecessors[parent] ?? -1;
    while (child >= 0) {
      if (secondary[parent])
        edges.push({ childOid: this.oid(child), parentOid: this.oid(parent) });
      parent = child;
      child = predecessors[parent] ?? -1;
    }
    return { root: parent, edges: edges.reverse() };
  }

  private wait(oid: string, child: number, slot: number) {
    this.missing.set(`${child}:${slot}`, oid);
    const children = this.waiting.get(oid);
    if (children === undefined) this.waiting.set(oid, [child, slot]);
    else children.push(child, slot);
  }

  private ordered() {
    if (this.added.length === 0 && !this.reranked) return this.sorted;
    const added = this.added;
    const first = this.sorted[0];
    const last = this.sorted.at(-1);
    const rank = (id: number) => this.ranks[id] ?? 0;
    const increasing = added.every(
      (id, index) => index === 0 || rank(added[index - 1] ?? id) < rank(id),
    );
    if (
      !this.reranked &&
      increasing &&
      last !== undefined &&
      rank(added[0] ?? last) > rank(last)
    )
      this.sorted.push(...added);
    else if (
      !this.reranked &&
      increasing &&
      first !== undefined &&
      rank(added.at(-1) ?? first) < rank(first)
    )
      this.sorted = [...added, ...this.sorted];
    else if (!this.reranked && first === undefined && increasing)
      this.sorted = [...added];
    else
      this.sorted = Array.from(this.oids, (_, id) => id).sort(
        (left, right) => rank(left) - rank(right),
      );
    this.added = [];
    this.reranked = false;
    this.positions = undefined;
    return this.sorted;
  }

  private positionsOf() {
    const sorted = this.ordered();
    if (this.positions === undefined) {
      const positions = new Int32Array(this.oids.length);
      sorted.forEach((id, index) => {
        positions[id] = index;
      });
      this.positions = positions;
    }
    return this.positions;
  }
}

function upperBound(values: Uint32Array, target: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] ?? 0) <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

class HistoryQueue {
  private readonly values: number[] = [];
  private readonly compare: (left: number, right: number) => number;

  constructor(compare: (left: number, right: number) => number) {
    this.compare = compare;
  }

  push(value: number) {
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const parentValue = this.values[parent];
      if (parentValue === undefined || this.compare(parentValue, value) <= 0)
        break;
      this.values[index] = parentValue;
      index = parent;
    }
    this.values[index] = value;
  }

  pop() {
    const first = this.values[0];
    const last = this.values.pop();
    if (this.values.length === 0 || last === undefined) return first;
    let index = 0;
    while (index * 2 + 1 < this.values.length) {
      let child = index * 2 + 1;
      const left = this.values[child];
      const right = this.values[child + 1];
      if (left === undefined) break;
      if (right !== undefined && this.compare(right, left) < 0) child += 1;
      const value = this.values[child];
      if (value === undefined || this.compare(last, value) <= 0) break;
      this.values[index] = value;
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}
