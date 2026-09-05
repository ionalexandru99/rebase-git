import { useCallback, useRef, useState } from "react";
import { describeRepositoryFetchError } from "#web/features/repository-history/freshness/repository-fetch-error";
import type {
  RepositoryHistoryReader,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader.contract";

interface FetchAttempt {
  readonly reader: Pick<RepositoryHistoryReader, "fetch">;
  readonly pending: boolean;
  readonly error?: string;
}

export function useRepositoryHistoryFetch(
  reader: Pick<RepositoryHistoryReader, "fetch"> | undefined,
  snapshot: RepositoryHistorySnapshot,
) {
  const pending = useRef(new Set<Pick<RepositoryHistoryReader, "fetch">>());
  const [attempt, setAttempt] = useState<FetchAttempt>();
  const execute = useCallback(() => {
    if (
      reader === undefined ||
      pending.current.has(reader) ||
      snapshot.freshness?.fetching
    )
      return;
    pending.current.add(reader);
    setAttempt({ reader, pending: true });
    void reader
      .fetch()
      .then(
        () => {
          setAttempt({ reader, pending: false });
        },
        (error: unknown) => {
          setAttempt({
            reader,
            pending: false,
            error: describeRepositoryFetchError(error),
          });
        },
      )
      .finally(() => pending.current.delete(reader));
  }, [reader, snapshot.freshness?.fetching]);
  return {
    execute,
    fetching:
      snapshot.freshness?.fetching === true ||
      (attempt?.reader === reader && attempt?.pending === true),
    error: attempt?.reader === reader ? attempt?.error : undefined,
  };
}
