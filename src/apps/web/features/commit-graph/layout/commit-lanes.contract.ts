export interface CommitTopology {
  readonly oid: string;
  readonly parents: readonly string[];
}

export interface CommitLanePosition {
  readonly id: number;
  readonly slot: number;
  readonly color: number;
}

export interface CommitLane extends CommitLanePosition {
  readonly expectedOid: string;
}

export interface CommitLaneCheckpoint {
  readonly lanes: readonly CommitLane[];
  readonly nextLaneId: number;
}

export interface CommitLaneRow {
  readonly lanesAfter: readonly CommitLanePosition[];
  readonly lanesBefore: readonly CommitLanePosition[];
  readonly nodeLaneId: number;
  readonly oid: string;
  readonly parentLaneIds: readonly number[];
}
