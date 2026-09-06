export interface HistoryOrderNode {
  readonly oid: string;
  readonly parents: readonly string[];
  readonly timestamp: number;
}

export interface HistoryParentEdge {
  readonly childOid: string;
  readonly parentOid: string;
}

export interface HistoryAncestryRoute {
  readonly rootOid: string;
  readonly edges: readonly HistoryParentEdge[];
  readonly continuationOid?: string;
}

export interface HistoryAncestryIndex {
  readonly oids: readonly string[];
  readonly positions: ReadonlyMap<string, number>;
  readonly parents: Uint32Array;
  readonly offsets: Uint32Array;
}

export interface HistoryOrderCache {
  index?: HistoryOrderIndexReader;
  preparation?: { readonly revision: number; readonly task: Promise<void> };
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
  readonly has: (oid: string) => boolean;
  readonly ancestryRoute: (
    roots: readonly string[],
    targetOid: string,
  ) => HistoryAncestryRoute | undefined;
  readonly order: (
    roots: readonly string[],
    order: "topological" | "chronological",
    previous?: readonly string[],
    ancestry?: "all" | "first-parent",
    additionalParentEdges?: readonly HistoryParentEdge[],
  ) => readonly string[];
}
