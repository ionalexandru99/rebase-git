import { Effect } from "effect";
import {
  RepositoryHistorySearchFailure,
  RepositoryHistorySearchSource,
} from "#web/features/repository-history/search/repository-history-search-model.contract";

export const historySearchPageSize = 20;

export const readNextHistorySearchPage = Effect.fn(function* (
  text: string,
  cursor: string | undefined,
) {
  const source = yield* RepositoryHistorySearchSource;
  let continuation = cursor;
  while (true) {
    const result = yield* source.search({
      text,
      limit: historySearchPageSize,
      ...(continuation === undefined ? {} : { cursor: continuation }),
    });
    if (result.commits.length > 0 || result.nextCursor === undefined)
      return result;
    if (result.nextCursor === continuation)
      return yield* new RepositoryHistorySearchFailure({
        operation: "search",
        cause: new Error("Search did not advance"),
      });
    continuation = result.nextCursor;
    yield* Effect.sleep(0);
  }
});

export const restoreSearchResults = Effect.fn(function* (
  text: string,
  selected: string | undefined,
) {
  if (selected === undefined)
    return yield* readNextHistorySearchPage(text, undefined);
  const source = yield* RepositoryHistorySearchSource;
  let result = yield* source.search({ text, limit: historySearchPageSize });
  const commits = [...result.commits];
  let restoredPages = 1;
  while (
    restoredPages < 5 &&
    !commits.some((commit) => commit.oid === selected) &&
    result.nextCursor !== undefined
  ) {
    result = yield* source.search({
      text,
      limit: historySearchPageSize,
      cursor: result.nextCursor,
    });
    restoredPages += 1;
    commits.push(...result.commits);
  }
  return { ...result, commits };
});
