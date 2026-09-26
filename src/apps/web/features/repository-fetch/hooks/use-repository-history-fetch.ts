import { useCallback, useRef, useState } from "react";
import { describeRepositoryFetchError } from "#web/features/repository-fetch/repository-fetch-error";
import type {
  RepositoryHistoryFetchCommands,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader";

interface FetchAttempt {
  readonly reader: Pick<RepositoryHistoryFetchCommands, "fetch">;
  readonly pending: boolean;
  readonly error?: string;
}

export function useRepositoryHistoryFetch(
  reader: Pick<RepositoryHistoryFetchCommands, "fetch"> | undefined,
  snapshot: RepositoryHistorySnapshot,
) {
  const pending = useRef(
    new Set<Pick<RepositoryHistoryFetchCommands, "fetch">>(),
  );
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
