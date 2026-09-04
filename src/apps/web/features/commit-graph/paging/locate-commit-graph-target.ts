import type { CommitGraphPageReader } from "#web/features/commit-graph/paging/commit-graph-page-window.contract";
import type { HistoryParentEdge } from "#web/features/repository-history/history-order.contract";
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
    let cursor: string | undefined = oid;
    const visited = new Set<string>();
    while (cursor !== undefined) {
      if (visited.has(cursor))
        throw new Error("The ancestry route did not advance.");
      visited.add(cursor);
      const route = await reader.ancestryRoute(
        query.roots.map((root) => root.oid),
        cursor,
      );
      signal.throwIfAborted();
      if (route === undefined) return undefined;
      edges.push(...route.edges);
      cursor = route.continuationOid;
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
