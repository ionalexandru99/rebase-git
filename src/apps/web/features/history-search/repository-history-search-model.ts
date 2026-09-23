import { Effect, Exit, Fiber, type ManagedRuntime, Scope } from "effect";
import type { RepositoryHistorySearch } from "#web/domain/history-search.contract";
import {
  readNextHistorySearchPage,
  restoreSearchResults,
} from "#web/features/history-search/read-next-history-search-page";
import {
  RepositoryHistorySearchFailure,
  type RepositoryHistorySearchModel,
  type RepositoryHistorySearchSnapshot,
  RepositoryHistorySearchSource,
} from "#web/features/history-search/repository-history-search-model.contract";
import { createStore } from "#web/platform/store/store";

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
  runtime: ManagedRuntime.ManagedRuntime<never, never>,
): RepositoryHistorySearchModel & {
  readonly refresh: (revision: number) => void;
  readonly dispose: () => Promise<void>;
} {
  const scope = Scope.makeUnsafe();
  const source = RepositoryHistorySearchSource.of({
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
  });
  const run = <A, E>(
    effect: Effect.Effect<A, E, RepositoryHistorySearchSource>,
  ) => {
    const fiber = runtime.runSync(
      effect.pipe(
        Effect.provideService(RepositoryHistorySearchSource, source),
        Effect.forkIn(scope),
      ),
    );
    return () => {
      runtime.runFork(Fiber.interrupt(fiber));
    };
  };
  const store = createStore(emptyHistorySearchSnapshot);
  const snapshot = store.getSnapshot;
  let revision: number | undefined;
  let selectedOid: string | undefined;
  let interrupt: (() => void) | undefined;
  let disposal: Promise<void> | undefined;
  let closed = false;

  function publish(next: RepositoryHistorySearchSnapshot) {
    if (!closed) store.set(next);
  }

  function search(delay = 0, text = snapshot().text) {
    if (closed) return;
    interrupt?.();
    publish({
      ...emptyHistorySearchSnapshot,
      text,
      loading: text.trim() !== "",
    });
    if (text.trim() === "") return;
    interrupt = run(
      restoreSearchResults(text, selectedOid).pipe(
        Effect.delay(delay),
        Effect.match({
          onFailure: (error) =>
            publish({ ...snapshot(), loading: false, error }),
          onSuccess: (result) => {
            const selected = result.commits.findIndex(
              (commit) => commit.oid === selectedOid,
            );
            if (selected === -1) selectedOid = undefined;
            publish({
              ...snapshot(),
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
    const { cursor, text } = snapshot();
    if (cursor !== undefined) {
      publish({ ...snapshot(), loading: true });
      const result = yield* readNextHistorySearchPage(text, cursor);
      publish({
        ...snapshot(),
        commits: [...snapshot().commits, ...result.commits],
        cursor: result.nextCursor,
        complete: result.replicaComplete,
        count: result.synchronizedCommitCount,
        loading: false,
      });
    }
  });

  const openResult = Effect.fn(function* (index: number) {
    if (index >= snapshot().commits.length) yield* loadPage();
    const commit = snapshot().commits[index];
    if (commit === undefined) return;
    selectedOid = commit.oid;
    publish({ ...snapshot(), selected: index });
    const source = yield* RepositoryHistorySearchSource;
    yield* source.navigate(commit.oid);
  });

  function navigate(index: number) {
    if (closed || snapshot().loading || snapshot().navigating) return;
    publish({ ...snapshot(), navigating: true, error: undefined });
    interrupt = run(
      openResult(index).pipe(
        Effect.match({
          onFailure: (error) =>
            publish({
              ...snapshot(),
              loading: false,
              navigating: false,
              error,
            }),
          onSuccess: () =>
            publish({ ...snapshot(), loading: false, navigating: false }),
        }),
      ),
    );
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    setText: (value) => {
      if (closed) return;
      const text = value.slice(0, 256);
      if (text === snapshot().text) return;
      selectedOid = undefined;
      search(200, text);
    },
    retry: () => search(),
    loadMore: () => {
      if (
        closed ||
        snapshot().loading ||
        snapshot().navigating ||
        snapshot().error !== undefined ||
        snapshot().cursor === undefined
      )
        return;
      interrupt = run(
        loadPage().pipe(
          Effect.catch((error) =>
            Effect.sync(() =>
              publish({ ...snapshot(), loading: false, error }),
            ),
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
    next: () => navigate(snapshot().selected + 1),
    previous: () =>
      navigate(
        snapshot().selected < 0
          ? snapshot().commits.length - 1
          : snapshot().selected - 1,
      ),
    dispose: () => {
      closed = true;
      disposal ??= runtime.runPromise(Scope.close(scope, Exit.void));
      return disposal;
    },
  };
}
