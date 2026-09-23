import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

export function normalizedOids(oids: readonly string[]) {
  return [...new Set(oids)].sort();
}

export function historyOrderScopeKey(
  query: Pick<
    RepositoryHistoryQuery,
    "order" | "roots" | "ancestry" | "additionalParentEdges"
  >,
) {
  return JSON.stringify([
    query.order,
    query.ancestry ?? "all",
    (query.additionalParentEdges ?? [])
      .map(({ childOid, parentOid }) => `${childOid}\0${parentOid}`)
      .toSorted(),
    query.roots
      .map(({ name, type, oid }) =>
        type === "head" ? [name, type, oid] : [name, type],
      )
      .sort(),
  ]);
}
