import type { CommitGraphPageReader } from "#web/features/commit-graph/paging/commit-graph-page-window.contract";
import type { HistoryParentEdge } from "#web/features/repository-history/query/history-order.contract";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

export async function locateCommitGraphTarget(
  reader: CommitGraphPageReader,
  query: RepositoryHistoryQuery,
  oid: string,
  signal: AbortSignal,
) {
  let effectiveQuery = query;
  let offset = await reader.locate(query, oid);
  signal.throwIfAborted();
  if (offset === undefined && query.ancestry === "first-parent") {
    const edges: HistoryParentEdge[] = [...(query.additionalParentEdges ?? [])];
    let roots = query.roots.map((root) => root.oid);
    const visited = new Set<string>();
    while (true) {
      const route = await reader.ancestryRoute(roots, oid);
      signal.throwIfAborted();
      if (route === undefined) return undefined;
      edges.push(...route.edges);
      const continuation = route.continuationOid;
      if (continuation === undefined) break;
      if (visited.has(continuation))
        throw new Error("The ancestry route did not advance.");
      visited.add(continuation);
      roots = [continuation];
    }
    effectiveQuery = {
      ...query,
      additionalParentEdges: [
        ...new Map(
          edges.map((edge) => [`${edge.childOid}\0${edge.parentOid}`, edge]),
        ).values(),
      ],
    };
    offset = await reader.locate(effectiveQuery, oid);
    signal.throwIfAborted();
  }
  return offset === undefined
    ? undefined
    : { oid, offset, query: effectiveQuery };
}
