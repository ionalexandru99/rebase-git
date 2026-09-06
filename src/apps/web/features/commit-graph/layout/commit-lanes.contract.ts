export interface CommitTopology {
  readonly oid: string;
  readonly parents: readonly string[];
}

export interface CommitLanePosition {
  readonly id: number;
  readonly slot: number;
  readonly color: number;
  readonly incomingColor?: number;
  readonly remote: boolean;
}

export interface CommitLaneSeed {
  readonly color: number;
  readonly remote: boolean;
  readonly boundary?: boolean;
}

export interface CommitLane extends CommitLanePosition {
  readonly expectedOid: string;
  readonly branchDepth: number;
}

export interface CommitLaneCheckpoint {
  readonly lanes: readonly CommitLane[];
  readonly nextLaneId: number;
}

export interface CommitLaneRow {
  readonly lanesAfter: readonly CommitLanePosition[];
  readonly lanesBefore: readonly CommitLanePosition[];
  readonly nodeLaneId: number;
  readonly nodeHasIncomingLane: boolean;
  readonly nodeRemote: boolean;
  readonly oid: string;
  readonly parentLaneIds: readonly number[];
}
