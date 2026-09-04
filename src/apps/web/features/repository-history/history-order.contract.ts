export interface HistoryOrderNode {
  readonly oid: string;
  readonly parents: readonly string[];
  readonly timestamp: number;
}

export interface HistoryOrderCache {
  index?: HistoryOrderIndexReader;
  revision: number;
  readonly queries: Map<
    string,
    { readonly basis: string; readonly oids: readonly string[] }
  >;
}

export interface HistoryOrderIndexReader {
  readonly order: (
    roots: readonly string[],
    order: "topological" | "chronological",
    previous?: readonly string[],
  ) => readonly string[];
}
