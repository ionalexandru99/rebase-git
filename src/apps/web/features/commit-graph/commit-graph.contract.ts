import type {
  RepositoryHistoryFetchCommands,
  RepositoryHistoryReadModel,
} from "#web/features/repository-history/index";

export type CommitGraphHistory = RepositoryHistoryReadModel &
  Pick<RepositoryHistoryFetchCommands, "fetch">;

export interface CommitGraphHandle {
  readonly focusSelection: () => void;
  readonly navigateToOid: (oid: string) => Promise<void>;
}

export interface CommitGraphViewportAnchor {
  readonly oid: string;
  readonly offset: number;
}

export interface CommitGraphViewportHandle {
  readonly getScrollOffset: () => number;
  readonly scrollToIndex: (index: number) => void;
}
