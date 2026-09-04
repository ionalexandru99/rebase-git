import type { RepositoryCommit } from "@rebase/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { readNextHistorySearchPage } from "#web/features/repository-history/search/read-next-history-search-page";
import type { RepositoryHistorySearch } from "#web/features/repository-history/search/repository-history-search.contract";

interface SearchState {
  readonly commits: readonly RepositoryCommit[];
  readonly cursor: string | undefined;
  readonly error: string | undefined;
  readonly complete: boolean;
  readonly count: number;
  readonly loading: boolean;
  readonly navigating: boolean;
  readonly selected: number;
}

const emptyState: SearchState = {
  commits: [],
  cursor: undefined,
  error: undefined,
  complete: false,
  count: 0,
  loading: false,
  navigating: false,
  selected: -1,
};

export function useRepositoryHistorySearch(
  reader: RepositoryHistorySearch,
  revision: number,
  onNavigate: (oid: string) => Promise<void>,
) {
  const [text, setText] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(emptyState);
  const session = useRef<AbortController | undefined>(undefined);
  const pending = useRef(false);
  const selection = useRef<
    { reader: RepositoryHistorySearch; text: string; oid: string } | undefined
  >(undefined);
  const request = useMemo(
    () => ({ reader, text, revision, attempt }),
    [reader, text, revision, attempt],
  );

  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    pending.current = false;
    setState({ ...emptyState, loading: request.text.trim() !== "" });
    if (request.text.trim() !== "") {
      pending.current = true;
      const selected =
        selection.current?.reader === request.reader &&
        selection.current.text === request.text
          ? selection.current.oid
          : undefined;
      void restoreSearchResults(
        request.reader,
        request.text,
        selected,
        controller.signal,
      )
        .then((result) => {
          if (controller.signal.aborted) return;
          setState({
            ...emptyState,
            commits: result.commits,
            cursor: result.nextCursor,
            complete: result.replicaComplete,
            count: result.synchronizedCommitCount,
            selected: result.commits.findIndex(
              (commit) => commit.oid === selected,
            ),
          });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setState({
              ...emptyState,
              error: "Could not search cached history.",
            });
        })
        .finally(() => {
          if (!controller.signal.aborted) pending.current = false;
        });
    }
    return () => controller.abort();
  }, [request]);

  const navigate = async (index: number) => {
    const controller = session.current;
    if (
      pending.current ||
      controller === undefined ||
      controller.signal.aborted
    )
      return;
    pending.current = true;
    setState((current) => ({ ...current, navigating: true, error: undefined }));
    try {
      let commits = state.commits;
      if (index >= commits.length && state.cursor !== undefined) {
        setState((current) => ({ ...current, loading: true }));
        const result = await readNextHistorySearchPage(
          reader,
          text,
          state.cursor,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        commits = [...commits, ...result.commits];
        setState((current) => ({
          ...current,
          commits,
          cursor: result.nextCursor,
          complete: result.replicaComplete,
          count: result.synchronizedCommitCount,
          loading: false,
        }));
      }
      const commit = commits[index];
      if (commit === undefined) return;
      selection.current = { reader, text, oid: commit.oid };
      setState((current) => ({ ...current, selected: index }));
      await onNavigate(commit.oid);
    } catch {
      if (!controller.signal.aborted)
        setState((current) => ({
          ...current,
          error: "Could not open this search result.",
        }));
    } finally {
      if (!controller.signal.aborted) {
        pending.current = false;
        setState((current) => ({
          ...current,
          loading: false,
          navigating: false,
        }));
      }
    }
  };

  return {
    ...state,
    text,
    setText: (value: string) => setText(value.slice(0, 256)),
    retry: () => setAttempt((value) => value + 1),
    navigate: (index: number) => {
      void navigate(index);
    },
    next: () => {
      void navigate(state.selected + 1);
    },
    previous: () => {
      void navigate(
        state.selected < 0 ? state.commits.length - 1 : state.selected - 1,
      );
    },
    canNext:
      !state.loading &&
      !state.navigating &&
      (state.selected + 1 < state.commits.length || state.cursor !== undefined),
    canPrevious:
      !state.loading &&
      !state.navigating &&
      (state.selected > 0 || (state.selected < 0 && state.commits.length > 0)),
  };
}

async function restoreSearchResults(
  reader: RepositoryHistorySearch,
  text: string,
  selected: string | undefined,
  signal: AbortSignal,
) {
  let result = await readNextHistorySearchPage(reader, text, undefined, signal);
  const commits = [...result.commits];
  while (
    selected !== undefined &&
    !commits.some((commit) => commit.oid === selected) &&
    result.nextCursor !== undefined
  ) {
    result = await readNextHistorySearchPage(
      reader,
      text,
      result.nextCursor,
      signal,
    );
    commits.push(...result.commits);
  }
  return { ...result, commits };
}
