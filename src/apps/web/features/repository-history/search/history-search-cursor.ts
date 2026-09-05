import { normalizeHistorySearch } from "#web/features/repository-history/search/history-metadata-search";

export function encodeHistorySearchCursor(
  environmentId: string,
  repositoryId: string,
  text: string,
  oid: string,
) {
  return encodeURIComponent(
    JSON.stringify([
      2,
      environmentId,
      repositoryId,
      normalizeHistorySearch(text),
      oid,
    ]),
  );
}

export function decodeHistorySearchCursor(
  environmentId: string,
  repositoryId: string,
  text: string,
  cursor: string | undefined,
): string | undefined {
  if (cursor === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(cursor));
    if (
      Array.isArray(value) &&
      value.length === 5 &&
      value[0] === 2 &&
      value[1] === environmentId &&
      value[2] === repositoryId &&
      value[3] === normalizeHistorySearch(text) &&
      typeof value[4] === "string" &&
      /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value[4])
    )
      return value[4];
  } catch {}
  throw new Error("History search cursor does not match this query");
}
