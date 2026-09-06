export interface HistoryTopology {
  readonly oids: readonly string[];
  readonly parents: Uint32Array;
  readonly offsets: Uint32Array;
  readonly timestamps: Float64Array;
}
