import type {
  CommitGraphHistory,
  CommitGraphReader,
} from "#web/features/commit-graph/commit-graph.contract";
import { createCommitGraphPageWindow } from "#web/features/commit-graph/paging/commit-graph-page-window";
import { commitGraphQuery } from "#web/features/commit-graph/paging/commit-graph-query";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/index";

export function openCommitGraphHistory(
  reader: CommitGraphReader,
): CommitGraphHistory {
  return { reader, pages: createCommitGraphPageWindow(reader) };
}

export function loadFirstCommitGraphPage(
  history: CommitGraphHistory,
  roots: RepositoryHistoryQuery["roots"],
  order: RepositoryHistoryQuery["order"],
) {
  if (history.pages.getSnapshot().requestedQuery !== undefined) return;
  void history.pages.reload(commitGraphQuery(roots, [], order, new Map()));
}
