import type { RepositoryCommit } from "@rebase/contracts";
import { HistoryOrderIndex } from "#web/features/repository-history/history-order";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

export function selectHistoryPage(
  commits: readonly RepositoryCommit[],
  query: RepositoryHistoryQuery,
) {
  if (query.ancestry !== "first-parent") return commits;
  const index = new HistoryOrderIndex(
    commits.map((commit) => ({
      oid: commit.oid,
      parents: commit.parents,
      timestamp: commit.committer.timestampSeconds,
    })),
  );
  const oids = new Set(
    index.order(
      query.roots.map(({ oid }) => oid),
      query.order,
      [],
      "first-parent",
      query.additionalParentEdges,
    ),
  );
  return commits.filter(({ oid }) => oids.has(oid));
}
