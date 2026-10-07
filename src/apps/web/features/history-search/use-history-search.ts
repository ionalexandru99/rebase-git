import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import { HistorySearchApi } from "#contracts/history-search/history-search.contract.ts";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import type { CodeMatchTarget } from "#web/features/commit-inspection/commit-input.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import type { HistorySearchPage } from "#web/features/repository-history/history-worker-protocol.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import {
  describeFailure,
  requestFailure,
} from "#web/platform/query/request-failure.ts";

const pageSize = 20;
const restoredPages = 5;
const searchFailed = "Could not search cached history.";

export type SearchMode = "Commits" | "Code";

export interface CodeSearchScope {
  readonly roots: readonly string[];
  readonly open: (
    oid: string,
    match: CodeMatchTarget,
    signal: AbortSignal,
  ) => Promise<void>;
}

interface HistorySearchState {
  readonly mode: SearchMode;
  readonly text: string;
  readonly path: string;
  readonly commits: readonly RepositoryCommit[];
  readonly files: ReadonlyMap<string, readonly string[]>;
  readonly cursor: string | undefined;
  readonly complete: boolean;
  readonly loading: boolean;
  readonly navigating: boolean;
  readonly selected: number;
  readonly progress: number | undefined;
  readonly error: string | undefined;
}

const noFiles: ReadonlyMap<string, readonly string[]> = new Map();

const emptySearch: HistorySearchState = {
  mode: "Commits",
  text: "",
  path: "",
  commits: [],
  files: noFiles,
  cursor: undefined,
  complete: false,
  loading: false,
  navigating: false,
  selected: -1,
  progress: undefined,
  error: undefined,
};

export function useHistorySearch(
  history: RepositoryHistory,
  revision: number,
  onNavigate: (oid: string, signal: AbortSignal) => Promise<void>,
  code: CodeSearchScope,
) {
  const [state, setState] = useState(emptySearch);
  const errorToast = useErrorToast();
  const { subscribe } = useEnvironment();
  const repository = useRepositoryScope();
  const navigating = state.navigating;
  const latest = useRef(state);
  const running = useRef<AbortController | undefined>(undefined);
  const selectedOid = useRef<string | undefined>(undefined);
  const navigate = useRef(onNavigate);
  const scope = useRef({ code, repository, subscribe });
  useLayoutEffect(() => {
    navigate.current = onNavigate;
    scope.current = { code, repository, subscribe };
  });
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

  const searchCode = useCallback(
    (signal: AbortSignal) => {
      const { text, path } = latest.current;
      const { code, repository, subscribe } = scope.current;
      if (repository === undefined || code.roots.length === 0) {
        publish({ ...latest.current, loading: false, progress: undefined });
        return;
      }
      let order = Promise.resolve();
      const show = (next: Partial<HistorySearchState>) => {
        if (!signal.aborted)
          flushSync(() => publish({ ...latest.current, ...next }));
      };
      const enqueue = (step: () => Promise<void> | void) => {
        order = order.then(() => {
          if (!signal.aborted) return step();
        });
      };
      void subscribe(
        HistorySearchApi.code,
        {
          repositoryId: repository.repositoryId,
          worktreePath: repository.worktreePath,
          text,
          roots: code.roots,
          ...(path.trim() === "" ? {} : { path: path.trim() }),
        },
        (update) => {
          if (update._tag === "CodeSearchProgress")
            enqueue(() => show({ progress: update.percent }));
          else
            enqueue(async () => {
              const commits = await history.ask(
                {
                  _tag: "Commits",
                  oids: update.matches.map((match) => match.oid),
                },
                signal,
              );
              const files = new Map(latest.current.files);
              for (const match of update.matches)
                files.set(match.oid, match.paths);
              show({ commits: [...latest.current.commits, ...commits], files });
            });
        },
        signal,
      )
        .then(() => order)
        .then(
          () => show({ loading: false, complete: true, progress: undefined }),
          (error: unknown) =>
            show({
              loading: false,
              progress: undefined,
              error: describeFailure(requestFailure<RepositoryRejected>(error)),
            }),
        );
    },
    [history, publish],
  );

  const search = useCallback(
    (keepResults = false) => {
      const signal = begin();
      const { mode, text, path } = latest.current;
      const searching = text.trim() !== "";
      if (!keepResults)
        publish({
          ...emptySearch,
          mode,
          text,
          path,
          loading: searching,
          progress: searching && mode === "Code" ? 0 : undefined,
        });
      if (!searching) return;
      if (mode === "Code") {
        searchCode(signal);
        return;
      }
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
    [begin, history, publish, searchCode],
  );

  const searched = useRef({ history, revision });
  useEffect(() => {
    const previous = searched.current;
    const switched = previous.history !== history;
    if (!switched && (navigating || previous.revision === revision)) return;
    searched.current = { history, revision };
    if (switched) search();
    else if (latest.current.mode === "Commits" && latest.current.text !== "")
      search(true);
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
    if (current.navigating || (current.mode === "Commits" && current.loading))
      return;
    const signal =
      current.mode === "Code" && running.current !== undefined
        ? running.current.signal
        : begin();
    publish({ ...current, navigating: true, error: undefined });
    void (async () => {
      if (index >= latest.current.commits.length) await loadPage(signal);
      const commit = latest.current.commits[index];
      if (commit === undefined) return;
      selectedOid.current = commit.oid;
      publish({ ...latest.current, selected: index });
      const paths = latest.current.files.get(commit.oid);
      if (latest.current.mode === "Code" && paths !== undefined)
        await scope.current.code.open(
          commit.oid,
          { text: latest.current.text, paths },
          signal,
        );
      else await navigate.current(commit.oid, signal);
    })().then(
      () => {
        if (!signal.aborted) settle();
      },
      () => {
        if (signal.aborted) return;
        settle();
        errorToast.show("openSearchResult");
      },
    );
  };

  const settle = () => {
    const current = latest.current;
    publish({
      ...current,
      navigating: false,
      loading: current.mode === "Code" && current.loading,
    });
  };

  const restart = (next: Partial<HistorySearchState>) => {
    selectedOid.current = undefined;
    publish({ ...latest.current, ...next });
    search();
  };

  return {
    ...state,
    setText: (value: string) => {
      const text = value.slice(0, 256);
      if (text !== latest.current.text) restart({ text });
    },
    setMode: (mode: SearchMode) => {
      if (mode !== latest.current.mode) restart({ mode });
    },
    setPath: (path: string) => {
      if (path !== latest.current.path) restart({ path });
    },
    stop: () => {
      running.current?.abort();
      running.current = undefined;
      publish({ ...latest.current, loading: false, progress: undefined });
    },
    retry: () => search(),
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
