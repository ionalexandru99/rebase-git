import { useCallback, useEffect, useRef, useState } from "react";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import type { HistorySearchPage } from "#web/features/repository-history/history-worker-protocol.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";

const pageSize = 20;
const restoredPages = 5;
const searchFailed = "Could not search cached history.";

interface HistorySearchState {
  readonly text: string;
  readonly commits: readonly RepositoryCommit[];
  readonly cursor: string | undefined;
  readonly complete: boolean;
  readonly loading: boolean;
  readonly navigating: boolean;
  readonly selected: number;
  readonly error: string | undefined;
}

const emptySearch: HistorySearchState = {
  text: "",
  commits: [],
  cursor: undefined,
  complete: false,
  loading: false,
  navigating: false,
  selected: -1,
  error: undefined,
};

export function useHistorySearch(
  history: RepositoryHistory,
  revision: number,
  onNavigate: (oid: string, signal: AbortSignal) => Promise<void>,
) {
  const [state, setState] = useState(emptySearch);
  const errorToast = useErrorToast();
  const navigating = state.navigating;
  const latest = useRef(state);
  const running = useRef<AbortController | undefined>(undefined);
  const selectedOid = useRef<string | undefined>(undefined);
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  const publish = useCallback((next: HistorySearchState) => {
    latest.current = next;
    setState(next);
  }, []);
  const begin = useCallback(() => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    return controller.signal;
  }, []);

  const search = useCallback(
    (text: string, keepResults = false) => {
      const signal = begin();
      if (!keepResults)
        publish({ ...emptySearch, text, loading: text.trim() !== "" });
      if (text.trim() === "") return;
      void restoreResults(history, text, selectedOid.current, signal).then(
        (page) => {
          if (signal.aborted) return;
          const selected = page.commits.findIndex(
            (commit) => commit.oid === selectedOid.current,
          );
          if (selected < 0) selectedOid.current = undefined;
          publish({
            ...latest.current,
            commits: page.commits,
            cursor: page.cursor,
            complete: page.complete,
            loading: false,
            selected,
          });
        },
        () => {
          if (!signal.aborted)
            publish({ ...latest.current, loading: false, error: searchFailed });
        },
      );
    },
    [begin, history, publish],
  );

  const searched = useRef({ history, revision });
  useEffect(() => {
    const previous = searched.current;
    const switched = previous.history !== history;
    if (!switched && (navigating || previous.revision === revision)) return;
    searched.current = { history, revision };
    const { text } = latest.current;
    if (switched) search(text);
    else if (text.trim() !== "") search(text, true);
  }, [history, revision, navigating, search]);
  useEffect(() => () => running.current?.abort(), []);

  const loadPage = async (signal: AbortSignal) => {
    const { cursor, text } = latest.current;
    if (cursor === undefined) return;
    publish({ ...latest.current, loading: true });
    const page = await readPage(history, text, cursor, signal);
    publish({
      ...latest.current,
      commits: [...latest.current.commits, ...page.commits],
      cursor: page.cursor,
      complete: page.complete,
      loading: false,
    });
  };

  const open = (index: number) => {
    const current = latest.current;
    if (current.loading || current.navigating) return;
    const signal = begin();
    publish({ ...current, navigating: true, error: undefined });
    void (async () => {
      if (index >= latest.current.commits.length) await loadPage(signal);
      const commit = latest.current.commits[index];
      if (commit === undefined) return;
      selectedOid.current = commit.oid;
      publish({ ...latest.current, selected: index });
      await navigate.current(commit.oid, signal);
    })().then(
      () => {
        if (!signal.aborted)
          publish({ ...latest.current, loading: false, navigating: false });
      },
      () => {
        if (signal.aborted) return;
        publish({ ...latest.current, loading: false, navigating: false });
        errorToast.show("openSearchResult");
      },
    );
  };

  return {
    ...state,
    setText: (value: string) => {
      const text = value.slice(0, 256);
      if (text === latest.current.text) return;
      selectedOid.current = undefined;
      search(text);
    },
    retry: () => search(latest.current.text),
    loadMore: () => {
      const current = latest.current;
      if (
        current.loading ||
        current.navigating ||
        current.error !== undefined ||
        current.cursor === undefined
      )
        return;
      const signal = begin();
      void loadPage(signal).catch(() => {
        if (!signal.aborted)
          publish({ ...latest.current, loading: false, error: searchFailed });
      });
    },
    navigate: open,
    next: () => open(latest.current.selected + 1),
    previous: () =>
      open(
        latest.current.selected < 0
          ? latest.current.commits.length - 1
          : latest.current.selected - 1,
      ),
  };
}

async function readPage(
  history: RepositoryHistory,
  text: string,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<HistorySearchPage> {
  let continuation = cursor;
  for (;;) {
    const page = await history.ask(
      {
        _tag: "Search",
        text,
        limit: pageSize,
        ...(continuation === undefined ? {} : { cursor: continuation }),
      },
      signal,
    );
    if (page.commits.length > 0 || page.cursor === undefined) return page;
    if (page.cursor === continuation)
      throw new Error("History search did not advance");
    continuation = page.cursor;
  }
}

async function restoreResults(
  history: RepositoryHistory,
  text: string,
  selected: string | undefined,
  signal: AbortSignal,
) {
  if (selected === undefined) return readPage(history, text, undefined, signal);
  let page = await history.ask(
    { _tag: "Search", text, limit: pageSize },
    signal,
  );
  const commits = [...page.commits];
  for (
    let restored = 1;
    restored < restoredPages &&
    !commits.some((commit) => commit.oid === selected) &&
    page.cursor !== undefined;
    restored += 1
  ) {
    page = await history.ask(
      { _tag: "Search", text, limit: pageSize, cursor: page.cursor },
      signal,
    );
    commits.push(...page.commits);
  }
  return { ...page, commits };
}
