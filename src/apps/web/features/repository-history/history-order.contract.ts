export interface HistoryOrderNode {
  readonly oid: string;
  readonly parents: readonly string[];
  readonly timestamp: number;
}

export interface HistoryParentEdge {
  readonly childOid: string;
  readonly parentOid: string;
}

export interface HistoryOrderCache {
  index?: HistoryOrderIndexReader;
  revision: number;
  readonly queries: Map<
    string,
    {
      readonly basis: string;
      readonly oids: readonly string[];
      readonly complete: boolean;
    }
  >;
}

export interface HistoryOrderIndexReader {
  readonly order: (
    roots: readonly string[],
    order: "topological" | "chronological",
    previous?: readonly string[],
    ancestry?: "all" | "first-parent",
    additionalParentEdges?: readonly HistoryParentEdge[],
  ) => readonly string[];
}
