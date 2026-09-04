import { normalizeHistorySearch } from "#web/features/repository-history/search/history-metadata-search";

export function encodeHistorySearchCursor(
  environmentId: string,
  repositoryId: string,
  text: string,
  position: readonly [number, string],
) {
  return encodeURIComponent(
    JSON.stringify([
      1,
      environmentId,
      repositoryId,
      normalizeHistorySearch(text),
      ...position,
    ]),
  );
}

export function decodeHistorySearchCursor(
  environmentId: string,
  repositoryId: string,
  text: string,
  cursor: string | undefined,
): readonly [number, string] | undefined {
  if (cursor === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(cursor));
    if (
      Array.isArray(value) &&
      value.length === 6 &&
      value[0] === 1 &&
      value[1] === environmentId &&
      value[2] === repositoryId &&
      value[3] === normalizeHistorySearch(text) &&
      typeof value[4] === "number" &&
      Number.isSafeInteger(value[4]) &&
      typeof value[5] === "string" &&
      /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value[5])
    )
      return [value[4], value[5]];
  } catch {}
  throw new Error("History search cursor does not match this query");
}
