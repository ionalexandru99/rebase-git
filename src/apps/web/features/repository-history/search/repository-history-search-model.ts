import { Effect, Layer, ManagedRuntime } from "effect";
import {
  readNextHistorySearchPage,
  restoreSearchResults,
} from "#web/features/repository-history/search/read-next-history-search-page";
import type { RepositoryHistorySearch } from "#web/features/repository-history/search/repository-history-search.contract";
import {
  RepositoryHistorySearchFailure,
  type RepositoryHistorySearchModel,
  type RepositoryHistorySearchSnapshot,
  RepositoryHistorySearchSource,
} from "#web/features/repository-history/search/repository-history-search-model.contract";

export const emptyHistorySearchSnapshot: RepositoryHistorySearchSnapshot = {
  text: "",
  commits: [],
  cursor: undefined,
  error: undefined,
  complete: false,
  count: 0,
  loading: false,
  navigating: false,
  selected: -1,
};

export function createRepositoryHistorySearchModel(
  reader: RepositoryHistorySearch,
  onNavigate: (oid: string, signal: AbortSignal) => Promise<void>,
): RepositoryHistorySearchModel & {
  readonly refresh: (revision: number) => void;
  readonly dispose: () => Promise<void>;
} {
  const runtime = ManagedRuntime.make(
    Layer.succeed(RepositoryHistorySearchSource)({
      search: (query) =>
        Effect.tryPromise({
          try: (signal) => reader.search(query, signal),
          catch: (cause) =>
            new RepositoryHistorySearchFailure({ operation: "search", cause }),
        }),
      navigate: (oid) =>
        Effect.tryPromise({
          try: (signal) => onNavigate(oid, signal),
          catch: (cause) =>
            new RepositoryHistorySearchFailure({
              operation: "navigate",
              cause,
            }),
        }),
    }),
  );
  let snapshot = emptyHistorySearchSnapshot;
  let revision: number | undefined;
  let selectedOid: string | undefined;
  let interrupt: (() => void) | undefined;
  let disposal: Promise<void> | undefined;
  let closed = false;
  const listeners = new Set<() => void>();

  function publish(next: RepositoryHistorySearchSnapshot) {
    if (closed) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function search(delay = 0) {
    if (closed) return;
    interrupt?.();
    const text = snapshot.text;
    publish({
      ...emptyHistorySearchSnapshot,
      text,
      loading: text.trim() !== "",
    });
    if (text.trim() === "") return;
    interrupt = runtime.runCallback(
      restoreSearchResults(text, selectedOid).pipe(
        Effect.delay(delay),
        Effect.match({
          onFailure: (error) => publish({ ...snapshot, loading: false, error }),
          onSuccess: (result) => {
            const selected = result.commits.findIndex(
              (commit) => commit.oid === selectedOid,
            );
            if (selected === -1) selectedOid = undefined;
            publish({
              ...snapshot,
              commits: result.commits,
              cursor: result.nextCursor,
              complete: result.replicaComplete,
              count: result.synchronizedCommitCount,
              loading: false,
              selected,
            });
          },
        }),
      ),
    );
  }

  const loadPage = Effect.fn(function* () {
    if (snapshot.cursor !== undefined) {
      publish({ ...snapshot, loading: true });
      const result = yield* readNextHistorySearchPage(
        snapshot.text,
        snapshot.cursor,
      );
      publish({
        ...snapshot,
        commits: [...snapshot.commits, ...result.commits],
        cursor: result.nextCursor,
        complete: result.replicaComplete,
        count: result.synchronizedCommitCount,
        loading: false,
      });
    }
  });

  const openResult = Effect.fn(function* (index: number) {
    if (index >= snapshot.commits.length) yield* loadPage();
    const commit = snapshot.commits[index];
    if (commit === undefined) return;
    selectedOid = commit.oid;
    publish({ ...snapshot, selected: index });
    const source = yield* RepositoryHistorySearchSource;
    yield* source.navigate(commit.oid);
  });

  function navigate(index: number) {
    if (closed || snapshot.loading || snapshot.navigating) return;
    publish({ ...snapshot, navigating: true, error: undefined });
    interrupt = runtime.runCallback(
      openResult(index).pipe(
        Effect.match({
          onFailure: (error) =>
            publish({ ...snapshot, loading: false, navigating: false, error }),
          onSuccess: () =>
            publish({ ...snapshot, loading: false, navigating: false }),
        }),
      ),
    );
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (closed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setText: (value) => {
      if (closed) return;
      const text = value.slice(0, 256);
      if (text === snapshot.text) return;
      selectedOid = undefined;
      snapshot = { ...snapshot, text };
      search(200);
    },
    retry: () => search(),
    loadMore: () => {
      if (
        closed ||
        snapshot.loading ||
        snapshot.navigating ||
        snapshot.error !== undefined ||
        snapshot.cursor === undefined
      )
        return;
      interrupt = runtime.runCallback(
        loadPage().pipe(
          Effect.catch((error) =>
            Effect.sync(() => publish({ ...snapshot, loading: false, error })),
          ),
        ),
      );
    },
    refresh: (next) => {
      if (closed || revision === next) return;
      revision = next;
      search();
    },
    navigate,
    next: () => navigate(snapshot.selected + 1),
    previous: () =>
      navigate(
        snapshot.selected < 0
          ? snapshot.commits.length - 1
          : snapshot.selected - 1,
      ),
    dispose: () => {
      closed = true;
      listeners.clear();
      disposal ??= runtime.dispose();
      return disposal;
    },
  };
}
