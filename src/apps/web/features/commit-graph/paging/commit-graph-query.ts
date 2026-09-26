import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import type { HistoryParentEdge } from "#web/features/repository-history/query/history-order.contract";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

export function commitGraphQuery(
  roots: RepositoryHistoryQuery["roots"],
  refTargets: readonly RepositoryHistoryRefTarget[],
  order: RepositoryHistoryQuery["order"],
  expanded: ReadonlyMap<string, readonly string[]>,
): RepositoryHistoryQuery {
  return {
    limit: 100,
    offset: 0,
    roots: roots.map(
      (root) =>
        refTargets.find(
          (ref) => ref.name === root.name && ref.type === root.type,
        ) ?? root,
    ),
    order,
    ancestry: "first-parent",
    additionalParentEdges: [...expanded].flatMap(([childOid, parents]) =>
      parents.map((parentOid) => ({ childOid, parentOid })),
    ),
  };
}

export function historyQueriesEqual(
  left: RepositoryHistoryQuery | undefined,
  right: RepositoryHistoryQuery | undefined,
) {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.limit === right.limit &&
    left.offset === right.offset &&
    left.order === right.order &&
    left.ancestry === right.ancestry &&
    refTargetsEqual(left.roots, right.roots) &&
    parentEdgesEqual(
      left.additionalParentEdges ?? [],
      right.additionalParentEdges ?? [],
    )
  );
}

export function refTargetsEqual(
  left: readonly RepositoryHistoryRefTarget[],
  right: readonly RepositoryHistoryRefTarget[],
) {
  return (
    left.length === right.length &&
    left.every(
      (ref, index) =>
        ref.name === right[index]?.name &&
        ref.oid === right[index]?.oid &&
        ref.type === right[index]?.type,
    )
  );
}

function parentEdgesEqual(
  left: readonly HistoryParentEdge[],
  right: readonly HistoryParentEdge[],
) {
  return (
    left.length === right.length &&
    left.every(
      (edge, index) =>
        edge.childOid === right[index]?.childOid &&
        edge.parentOid === right[index]?.parentOid,
    )
  );
}
