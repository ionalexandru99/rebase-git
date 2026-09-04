export interface CommitGraphHandle {
  readonly navigateToOid: (oid: string) => Promise<void>;
}

export interface CommitGraphViewportAnchor {
  readonly oid: string;
  readonly offset: number;
}

export interface CommitGraphViewportHandle {
  readonly scrollToIndex: (index: number) => void;
}
