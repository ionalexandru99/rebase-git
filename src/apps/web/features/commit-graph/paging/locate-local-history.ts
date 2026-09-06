import type { RepositoryCommit } from "@rebase/contracts";
import type { CommitGraphPageReader } from "#web/features/commit-graph/paging/commit-graph-page-window.contract";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

export async function locateLocalHistory(
  reader: CommitGraphPageReader,
  query: RepositoryHistoryQuery,
  commits: readonly RepositoryCommit[],
  signal: AbortSignal,
) {
  const roots = query.roots.filter(
    (root) => root.type === "branch" || root.type === "head",
  );
  if (roots.length === query.roots.length)
    return new Set(commits.map((commit) => commit.oid));
  const local = new Set<string>();
  if (roots.length === 0) return local;
  const scope = {
    ...query,
    roots,
    ancestry: "all" as const,
    additionalParentEdges: [],
  };
  for (let start = 0; start < commits.length; start += 1_000) {
    signal.throwIfAborted();
    const positions = await reader.locateMany(
      scope,
      commits.slice(start, start + 1_000).map((commit) => commit.oid),
    );
    signal.throwIfAborted();
    for (const { oid } of positions) local.add(oid);
  }
  return local;
}
