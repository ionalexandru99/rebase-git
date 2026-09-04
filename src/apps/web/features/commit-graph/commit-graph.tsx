import type { RepositoryCommit } from "@rebase/contracts";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type JSX,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { describeRepositoryHistoryError } from "#web/features/commit-graph/commit-graph-messages";
import {
  appendCommitLanes,
  createCommitLaneCheckpoint,
} from "#web/features/commit-graph/commit-lanes";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";
import { Button } from "#web-ui/components/ui/button";
import {
  CommitGraphCanvas,
  commitGraphGutterWidth,
} from "#web-ui/features/commit-graph/commit-graph-canvas";

const rowHeight = 36;
const overscanRows = 10;
const loadingRowIds = Array.from(
  { length: 12 },
  (_, index) => `commit-loading-row-${index}`,
);
const emptyHistorySnapshot = { revision: 0, status: "empty" } as const;
const noSnapshotSubscription = () => () => undefined;

export function CommitGraph({
  reader,
  repositoryName,
  roots,
}: {
  readonly reader: RepositoryHistoryReader | undefined;
  readonly repositoryName: string;
  readonly roots: RepositoryHistoryQuery["roots"] | undefined;
}): JSX.Element {
  const [commits, setCommits] = useState<readonly RepositoryCommit[]>([]);
  const [error, setError] =
    useState<ReturnType<RepositoryHistoryReader["getSnapshot"]>["error"]>();
  const [loading, setLoading] = useState(true);
  const [selectedOid, setSelectedOid] = useState<string>();
  const loadEpoch = useRef(0);
  const commitsRef = useRef(commits);
  commitsRef.current = commits;
  const pendingViewportAnchor = useRef<ViewportAnchor | undefined>(undefined);
  const previousReader = useRef(reader);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ height: 0, width: 0 });
  const [horizontalOffset, setHorizontalOffset] = useState(0);
  const historySnapshot = useSyncExternalStore(
    reader?.subscribe ?? noSnapshotSubscription,
    reader?.getSnapshot ?? (() => emptyHistorySnapshot),
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) {
        return;
      }
      setViewport({
        height: entry.contentRect.height,
        width: entry.contentRect.width,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const loadHistory = useCallback(() => {
    const epoch = ++loadEpoch.current;
    if (reader === undefined || roots === undefined) {
      setLoading(true);
      return;
    }
    if (roots.length === 0) {
      setCommits([]);
      setError(undefined);
      setLoading(false);
      setSelectedOid(undefined);
      if (scrollRef.current !== null) {
        scrollRef.current.scrollTop = 0;
      }
      return;
    }
    pendingViewportAnchor.current = viewportAnchor(
      scrollRef.current,
      commitsRef.current,
    );
    setLoading(true);
    setError(undefined);
    void reader
      .read({ limit: 100, order: "topological", roots })
      .then(
        (next) => {
          if (epoch !== loadEpoch.current) {
            return;
          }
          setCommits(next);
          setSelectedOid((selected) =>
            next.some((commit) => commit.oid === selected)
              ? selected
              : next[0]?.oid,
          );
        },
        () => {
          if (epoch !== loadEpoch.current) {
            return;
          }
          setError(reader.getSnapshot().error);
        },
      )
      .finally(() => {
        if (epoch === loadEpoch.current) {
          setLoading(false);
        }
      });
  }, [reader, roots]);

  useEffect(() => {
    if (previousReader.current !== reader) {
      previousReader.current = reader;
      setCommits([]);
      setError(undefined);
      setSelectedOid(undefined);
      if (scrollRef.current !== null) {
        scrollRef.current.scrollTop = 0;
      }
    }
    loadHistory();
    return () => {
      loadEpoch.current += 1;
    };
  }, [loadHistory, reader]);

  useLayoutEffect(() => {
    const anchor = pendingViewportAnchor.current;
    const element = scrollRef.current;
    if (anchor === undefined || element === null) {
      return;
    }
    pendingViewportAnchor.current = undefined;
    const index = commits.findIndex((commit) => commit.oid === anchor.oid);
    if (index >= 0) {
      element.scrollTop = index * rowHeight + anchor.offset;
    }
  }, [commits]);

  const laneRows = useMemo(
    () =>
      appendCommitLanes(
        createCommitLaneCheckpoint(),
        commits.map((commit) => ({ oid: commit.oid, parents: commit.parents })),
      ).rows,
    [commits],
  );
  const gutterWidth = commitGraphGutterWidth(laneRows);
  const virtualizer = useVirtualizer({
    count: commits.length,
    estimateSize: () => rowHeight,
    getScrollElement: () => scrollRef.current,
    overscan: overscanRows,
  });
  const virtualRows = virtualizer.getVirtualItems();

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const current = commits.findIndex((commit) => commit.oid === selectedOid);
    const next = Math.min(
      commits.length - 1,
      Math.max(0, current + (event.key === "ArrowDown" ? 1 : -1)),
    );
    const commit = commits[next];
    if (commit === undefined) {
      return;
    }
    setSelectedOid(commit.oid);
    virtualizer.scrollToIndex(next, { align: "auto" });
  };

  return (
    <section
      aria-label="Commit graph"
      className="flex h-full min-h-0 flex-col bg-repository"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-border/60 border-b px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">
            {repositoryName}
          </h1>
          <p className="m-0 text-[11px] text-muted-foreground">Commit graph</p>
        </div>
        {historySnapshot.synchronization === "syncing" ? (
          <span className="text-[11px] text-muted-foreground" role="status">
            Syncing
          </span>
        ) : historySnapshot.synchronization === "stale" ||
          (!loading && error !== undefined && commits.length > 0) ? (
          <Button onClick={loadHistory} size="sm" variant="ghost">
            Stale. Retry
          </Button>
        ) : null}
      </header>
      <div
        className="grid h-8 shrink-0 items-center border-border/60 border-b text-[11px] text-muted-foreground"
        style={{
          gridTemplateColumns: `${gutterWidth}px minmax(16rem, 1fr) 10rem 7rem`,
          minWidth: gutterWidth + 528,
        }}
      >
        <span className="px-3">Graph</span>
        <span>Commit</span>
        <span>Author</span>
        <span>Date</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          aria-activedescendant={
            selectedOid === undefined ? undefined : commitRowId(selectedOid)
          }
          aria-busy={loading}
          aria-label="Commit history"
          aria-multiselectable="false"
          className="absolute inset-0 overflow-auto focus-visible:outline-2 focus-visible:outline-primary/70 focus-visible:outline-offset-[-2px]"
          onKeyDown={handleKeyDown}
          onScroll={(event) =>
            setHorizontalOffset(event.currentTarget.scrollLeft)
          }
          ref={scrollRef}
          role="listbox"
          tabIndex={0}
        >
          <div
            className="relative"
            role="presentation"
            style={{
              height: virtualizer.getTotalSize(),
              minWidth: gutterWidth + 528,
            }}
          >
            {virtualRows.map((virtualRow) => {
              const commit = commits[virtualRow.index];
              if (commit === undefined) {
                return null;
              }
              const selected = commit.oid === selectedOid;
              return (
                <div
                  aria-label={commitAriaLabel(commit)}
                  aria-posinset={virtualRow.index + 1}
                  aria-selected={selected}
                  aria-setsize={commits.length}
                  className={`absolute top-0 left-0 grid w-full cursor-default items-center border-border/40 border-b text-xs ${
                    selected
                      ? "bg-primary/12 text-foreground"
                      : "text-foreground hover:bg-accent/35"
                  }`}
                  id={commitRowId(commit.oid)}
                  key={commit.oid}
                  onClick={() => setSelectedOid(commit.oid)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedOid(commit.oid);
                    }
                  }}
                  role="option"
                  style={{
                    gridTemplateColumns: `${gutterWidth}px minmax(16rem, 1fr) 10rem 7rem`,
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  tabIndex={-1}
                >
                  <span aria-hidden="true" />
                  <span className="truncate pr-4">{commit.subject}</span>
                  <span className="truncate pr-4 text-muted-foreground">
                    {commit.author.name}
                  </span>
                  <time
                    className="truncate pr-3 text-muted-foreground"
                    dateTime={new Date(
                      commit.committer.timestampSeconds * 1_000,
                    ).toISOString()}
                  >
                    {formatCommitDate(commit.committer.timestampSeconds)}
                  </time>
                </div>
              );
            })}
          </div>
        </div>
        {commits.length > 0 ? (
          <CommitGraphCanvas
            height={viewport.height}
            horizontalOffset={horizontalOffset}
            laneRows={laneRows}
            virtualRows={virtualRows}
            verticalOffset={virtualizer.scrollOffset ?? 0}
            width={Math.min(gutterWidth, viewport.width)}
          />
        ) : null}
        {loading && commits.length === 0 ? <CommitGraphLoading /> : null}
        {!loading && error !== undefined ? (
          <CommitGraphFailure
            error={describeRepositoryHistoryError(error)}
            retry={loadHistory}
          />
        ) : null}
        {!loading && error === undefined && commits.length === 0 ? (
          <div
            className="absolute inset-0 grid place-items-center text-sm text-muted-foreground"
            role="status"
          >
            This repository has no commits yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CommitGraphLoading() {
  return (
    <div
      aria-label="Loading commit history"
      className="pointer-events-none absolute inset-0 bg-repository"
      role="status"
    >
      {loadingRowIds.map((rowId) => (
        <div
          className="grid h-9 grid-cols-[4rem_minmax(12rem,1fr)_10rem_7rem] items-center border-border/40 border-b px-3"
          key={rowId}
        >
          <span className="h-px w-7 bg-border" />
          <span className="h-2 w-2/5 rounded-sm bg-muted" />
          <span className="h-2 w-20 rounded-sm bg-muted" />
          <span className="h-2 w-12 rounded-sm bg-muted" />
        </div>
      ))}
    </div>
  );
}

function CommitGraphFailure({
  error,
  retry,
}: {
  readonly error: string;
  readonly retry: () => void;
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
      role="alert"
    >
      <p className="m-0 max-w-md text-sm text-muted-foreground">{error}</p>
      <Button onClick={retry} size="sm" variant="outline">
        Retry
      </Button>
    </div>
  );
}

function commitAriaLabel(commit: RepositoryCommit) {
  const parents = commit.parents.length;
  return `${commit.subject}, ${commit.author.name}, ${shortOid(commit.oid)}, ${parents} ${parents === 1 ? "parent" : "parents"}`;
}

function commitRowId(oid: string) {
  return `commit-${oid}`;
}

function shortOid(oid: string) {
  return oid.slice(0, 8);
}

function viewportAnchor(
  element: HTMLDivElement | null,
  commits: readonly RepositoryCommit[],
): ViewportAnchor | undefined {
  if (element === null || element.scrollTop <= 0) {
    return undefined;
  }
  const index = Math.floor(element.scrollTop / rowHeight);
  const commit = commits[index];
  return commit === undefined
    ? undefined
    : { oid: commit.oid, offset: element.scrollTop - index * rowHeight };
}

interface ViewportAnchor {
  readonly offset: number;
  readonly oid: string;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatCommitDate(timestampSeconds: number) {
  return dateFormatter.format(new Date(timestampSeconds * 1_000));
}
