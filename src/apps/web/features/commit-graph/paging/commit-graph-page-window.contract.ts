import type { RepositoryCommit } from "@rebase/contracts";
import type {
  CommitLaneCheckpoint,
  CommitLaneRow,
  CommitTopology,
} from "#web/features/commit-graph/commit-lanes";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";

export interface CommitGraphPageReader
  extends Pick<RepositoryHistoryReader, "read" | "locate" | "ancestryRoute"> {
  readonly locateMany: (
    query: RepositoryHistoryQuery,
    oids: readonly string[],
  ) => Promise<readonly { readonly oid: string; readonly index: number }[]>;
}

export interface CommitGraphPage {
  readonly merges: ReadonlyMap<string, "collapsed" | "expanded">;
  readonly offset: number;
  readonly commits: readonly RepositoryCommit[];
  readonly topology: readonly CommitTopology[];
  readonly rows: readonly CommitLaneRow[];
  readonly incomingCheckpoint: CommitLaneCheckpoint;
  readonly outgoingCheckpoint: CommitLaneCheckpoint;
  readonly estimatedBytes: number;
}

export interface CommitGraphPageWindowSnapshot {
  readonly epoch: number;
  readonly query: RepositoryHistoryQuery | undefined;
  readonly pages: readonly CommitGraphPage[];
  readonly startOffset: number;
  readonly endOffset: number;
  readonly knownEndOffset: number;
  readonly hasOlder: boolean;
  readonly loading: boolean;
  readonly error:
    | { readonly offset: number; readonly message: string }
    | undefined;
  readonly anchorOid: string | undefined;
  readonly pendingMove: number | undefined;
  readonly estimatedBytes: number;
  readonly checkpointCount: number;
}

export interface CommitGraphPageWindowOptions {
  readonly pageSize?: number;
  readonly maximumPages?: number;
  readonly maximumBytes?: number;
}

export interface CommitGraphPageWindow {
  readonly getSnapshot: () => CommitGraphPageWindowSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
  readonly loadInitial: (
    query: RepositoryHistoryQuery,
    anchorOid?: string,
  ) => Promise<void>;
  readonly reload: (
    query: RepositoryHistoryQuery,
    anchorOid?: string,
  ) => Promise<void>;
  readonly appendOlder: () => Promise<void>;
  readonly prefetchOffset: (offset: number) => Promise<void>;
  readonly setViewport: (firstOffset: number, lastOffset: number) => void;
  readonly requestMove: (
    offset: number,
  ) => Promise<{ readonly oid: string; readonly offset: number } | undefined>;
  readonly jumpToOid: (oid: string) => Promise<
    | {
        readonly oid: string;
        readonly offset: number;
        readonly query: RepositoryHistoryQuery;
      }
    | undefined
  >;
  readonly retry: () => Promise<void>;
}
