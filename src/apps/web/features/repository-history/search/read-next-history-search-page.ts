import type { RepositoryHistorySearch } from "#web/features/repository-history/search/repository-history-search.contract";

export const historySearchPageSize = 20;

export async function readNextHistorySearchPage(
  reader: RepositoryHistorySearch,
  text: string,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  let continuation = cursor;
  while (true) {
    signal.throwIfAborted();
    const result = await reader.search(
      {
        text,
        limit: historySearchPageSize,
        ...(continuation === undefined ? {} : { cursor: continuation }),
      },
      signal,
    );
    signal.throwIfAborted();
    if (result.commits.length > 0 || result.nextCursor === undefined)
      return result;
    if (result.nextCursor === continuation)
      throw new Error("Search did not advance");
    continuation = result.nextCursor;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
