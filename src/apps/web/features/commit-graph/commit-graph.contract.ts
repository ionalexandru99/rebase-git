import type { CommitGraphPageWindow } from "#web/features/commit-graph/paging/commit-graph-page-window.contract";
import type {
  RepositoryHistoryFetchCommands,
  RepositoryHistoryReadModel,
} from "#web/features/repository-history/index";

export type CommitGraphReader = RepositoryHistoryReadModel &
  Pick<RepositoryHistoryFetchCommands, "fetch">;

export interface CommitGraphHistory {
  readonly reader: CommitGraphReader;
  readonly pages: CommitGraphPageWindow;
}

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
