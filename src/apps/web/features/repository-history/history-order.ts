import type {
  HistoryOrderIndexReader,
  HistoryOrderNode,
} from "#web/features/repository-history/history-order.contract";

export class HistoryOrderIndex implements HistoryOrderIndexReader {
  private readonly positions: Map<string, number>;
  private readonly oids: readonly string[];
  private readonly parents: Uint32Array;
  private readonly offsets: Uint32Array;
  private readonly timestamps: Float64Array;

  constructor(nodes: readonly HistoryOrderNode[]) {
    this.oids = nodes.map(({ oid }) => oid);
    this.positions = new Map(this.oids.map((oid, index) => [oid, index]));
    this.offsets = new Uint32Array(nodes.length + 1);
    this.timestamps = new Float64Array(nodes.length);
    const parents: number[] = [];
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node === undefined) continue;
      this.offsets[index] = parents.length;
      this.timestamps[index] = node.timestamp;
      for (const oid of node.parents) {
        const parent = this.positions.get(oid);
        if (parent !== undefined) parents.push(parent);
      }
    }
    this.offsets[nodes.length] = parents.length;
    this.parents = Uint32Array.from(parents);
  }

  order(
    roots: readonly string[],
    order: "topological" | "chronological",
    previous: readonly string[] = [],
  ): readonly string[] {
    const reachable = new Uint8Array(this.oids.length);
    const children = new Uint32Array(this.oids.length);
    const pending = roots.flatMap((oid) => {
      const index = this.positions.get(oid);
      return index === undefined ? [] : [index];
    });
    const reached: number[] = [];
    while (pending.length > 0) {
      const index = pending.pop();
      if (index === undefined || reachable[index]) continue;
      reachable[index] = 1;
      reached.push(index);
      this.forEachParent(index, (parent) => {
        children[parent] = (children[parent] ?? 0) + 1;
        if (!reachable[parent]) pending.push(parent);
      });
    }
    const successors = new Int32Array(this.oids.length).fill(-1);
    const priorPositions = new Int32Array(this.oids.length).fill(-1);
    let previousIndex: number | undefined;
    for (let rank = 0; rank < previous.length; rank += 1) {
      const oid = previous[rank];
      const index = oid === undefined ? undefined : this.positions.get(oid);
      if (index === undefined || !reachable[index]) continue;
      priorPositions[index] = rank;
      if (previousIndex !== undefined) {
        successors[previousIndex] = index;
        children[index] = (children[index] ?? 0) + 1;
      }
      previousIndex = index;
    }
    const ready = new HistoryOrderQueue((left, right) => {
      if (order === "chronological") {
        const difference =
          (this.timestamps[right] ?? 0) - (this.timestamps[left] ?? 0);
        if (difference !== 0) return difference;
      }
      const priorLeft = priorPositions[left] ?? -1;
      const priorRight = priorPositions[right] ?? -1;
      if (priorLeft >= 0 || priorRight >= 0)
        return (
          (priorLeft < 0 ? Number.MAX_SAFE_INTEGER : priorLeft) -
          (priorRight < 0 ? Number.MAX_SAFE_INTEGER : priorRight)
        );
      return left - right;
    });
    for (const index of reached) if (children[index] === 0) ready.push(index);
    const result: string[] = [];
    const release = (index: number) => {
      children[index] = (children[index] ?? 0) - 1;
      if (children[index] === 0) ready.push(index);
    };
    let index = ready.pop();
    while (index !== undefined) {
      const oid = this.oids[index];
      if (oid === undefined)
        throw new Error("History ordering node is missing");
      result.push(oid);
      this.forEachParent(index, release);
      const successor = successors[index] ?? -1;
      if (successor >= 0) release(successor);
      index = ready.pop();
    }
    if (result.length !== reached.length)
      throw new Error("History topology is inconsistent");
    return result;
  }

  private forEachParent(index: number, visit: (parent: number) => void) {
    const end = this.offsets[index + 1] ?? 0;
    for (let offset = this.offsets[index] ?? 0; offset < end; offset += 1) {
      const parent = this.parents[offset];
      if (parent !== undefined) visit(parent);
    }
  }
}

class HistoryOrderQueue {
  private readonly values: number[] = [];
  private readonly compare: (left: number, right: number) => number;

  constructor(compare: (left: number, right: number) => number) {
    this.compare = compare;
  }

  push(value: number) {
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
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
