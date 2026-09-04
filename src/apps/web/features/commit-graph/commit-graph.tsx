import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
  RepositoryRefTarget,
} from "@rebase/contracts";
import { IconX } from "@tabler/icons-react";
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
import type { HistoryScope } from "#web/features/commit-graph/history-scope.contract";
import { visibleMergeTopology } from "#web/features/commit-graph/merge-visibility";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";
import { Button } from "#web-ui/components/ui/button";
import {
  CommitGraphCanvas,
  commitGraphGutterWidth,
} from "#web-ui/features/commit-graph/commit-graph-canvas";
import { CommitGraphMergeControls } from "#web-ui/features/commit-graph/commit-graph-merge-controls";

const rowHeight = 36;
const overscanRows = 10;
const loadingRowIds = Array.from(
  { length: 12 },
  (_, index) => `commit-loading-row-${index}`,
);
const emptyHistorySnapshot = {
  revision: 0,
  historyRevision: 0,
  status: "empty",
} as const;
const noSnapshotSubscription = () => () => undefined;

export function CommitGraph({
  onRemoveHistoryRef,
  reader,
  repositoryName,
  roots,
  scope,
  selections,
}: {
  readonly onRemoveHistoryRef?: (target: RepositoryRefTarget) => void;
  readonly reader: RepositoryHistoryReader | undefined;
  readonly repositoryName: string;
  readonly roots: RepositoryHistoryQuery["roots"] | undefined;
  readonly scope?: HistoryScope;
  readonly selections?: readonly RepositoryRefTarget[];
}): JSX.Element {
  const [commits, setCommits] = useState<readonly RepositoryCommit[]>([]);
  const [loadedRoots, setLoadedRoots] = useState<readonly string[]>([]);
  const [error, setError] =
    useState<ReturnType<RepositoryHistoryReader["getSnapshot"]>["error"]>();
  const [loading, setLoading] = useState(true);
  const [selectedOid, setSelectedOid] = useState<string>();
  const [activeOid, setActiveOid] = useState<string>();
  const [expandedMerges, setExpandedMerges] = useState<
    ReadonlyMap<string, readonly string[]>
  >(new Map());
  const visible = useMemo(
    () =>
      visibleMergeTopology(
        commits,
        loadedRoots,
        new Set(expandedMerges.keys()),
      ),
    [commits, loadedRoots, expandedMerges],
  );
  const visibleCommits = visible.commits;
  const [order, setOrder] =
    useState<RepositoryHistoryQuery["order"]>("topological");
  const previousOrder = useRef(order);
  const selectedOidRef = useRef(selectedOid);
  selectedOidRef.current = selectedOid;
  const loadEpoch = useRef(0);
  const commitsRef = useRef(commits);
  commitsRef.current = visibleCommits;
  const pendingViewportAnchor = useRef<ViewportAnchor | undefined>(undefined);
  const previousReader = useRef(reader);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ height: 0, width: 0 });
  const [horizontalOffset, setHorizontalOffset] = useState(0);
  const [refTargets, setRefTargets] = useState<
    readonly RepositoryHistoryRefTarget[]
  >([]);
  const historySnapshot = useSyncExternalStore(
    reader?.subscribe ?? noSnapshotSubscription,
    reader?.getSnapshot ?? (() => emptyHistorySnapshot),
  );
  const refTargetRefresh = `${historySnapshot.status}:${
    historySnapshot.synchronization ?? ""
  }`;
  const refTargetsEpoch = useRef(0);
  useEffect(() => {
    if (refTargetRefresh.length === 0) return;
    const epoch = ++refTargetsEpoch.current;
    if (reader === undefined) {
      setRefTargets([]);
      return;
    }
    void reader.getRefTargets().then(
      (next) => {
        if (epoch === refTargetsEpoch.current) setRefTargets(next);
      },
      () => {
        if (epoch === refTargetsEpoch.current) setRefTargets([]);
      },
    );
    return () => {
      refTargetsEpoch.current += 1;
    };
  }, [reader, refTargetRefresh]);

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
    if (previousOrder.current !== order) {
      previousOrder.current = order;
      const selected = selectedOidRef.current;
      if (selected !== undefined)
        pendingViewportAnchor.current = { oid: selected, offset: 0 };
    }
    setLoading(true);
    setError(undefined);
    void reader
      .read({
        limit: 100,
        order,
        roots,
        ancestry: "first-parent",
        additionalParentEdges: [...expandedMerges].flatMap(
          ([childOid, parents]) =>
            parents.map((parentOid) => ({ childOid, parentOid })),
        ),
      })
      .then(
        (next) => {
          if (epoch !== loadEpoch.current) {
            return;
          }
          setCommits(next);
          setLoadedRoots(roots.map(({ oid }) => oid));
          setSelectedOid((selected) =>
            next.some((commit) => commit.oid === selected)
              ? selected
              : undefined,
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
  }, [reader, roots, order, expandedMerges]);

  useEffect(() => {
    if (previousReader.current !== reader) {
      previousReader.current = reader;
      setCommits([]);
      setError(undefined);
      setSelectedOid(undefined);
      setActiveOid(undefined);
      setExpandedMerges(new Map());
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
    const index = visibleCommits.findIndex(
      (commit) => commit.oid === anchor.oid,
    );
    if (index >= 0) {
      element.scrollTop = index * rowHeight + anchor.offset;
    }
  }, [visibleCommits]);

  useEffect(() => {
    if (
      selectedOid !== undefined &&
      !visibleCommits.some(({ oid }) => oid === selectedOid)
    )
      setSelectedOid(undefined);
    if (
      activeOid !== undefined &&
      !visibleCommits.some(({ oid }) => oid === activeOid)
    )
      setActiveOid(undefined);
  }, [activeOid, selectedOid, visibleCommits]);

  const previousSynchronization = useRef(historySnapshot.synchronization);
  useEffect(() => {
    if (
      previousSynchronization.current !== "complete" &&
      historySnapshot.synchronization === "complete"
    )
      loadHistory();
    previousSynchronization.current = historySnapshot.synchronization;
  }, [historySnapshot.synchronization, loadHistory]);

  const laneRows = useMemo(
    () =>
      appendCommitLanes(createCommitLaneCheckpoint(), visible.topology).rows,
    [visible.topology],
  );
  const labelsByOid = useMemo(() => groupRefLabels(refTargets), [refTargets]);
  const gutterWidth = commitGraphGutterWidth(laneRows);
  const virtualizer = useVirtualizer({
    count: visibleCommits.length,
    estimateSize: () => rowHeight,
    getScrollElement: () => scrollRef.current,
    overscan: overscanRows,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const activeCommitOid = activeOid ?? selectedOid;

  const toggleMerge = (oid: string, expand: boolean) => {
    const commit = commits.find((candidate) => candidate.oid === oid);
    if (commit === undefined || commit.parents.length < 2) return;
    setActiveOid(oid);
    setExpandedMerges((current) => {
      if (expand === current.has(oid)) return current;
      const next = new Map(current);
      if (expand) next.set(oid, commit.parents.slice(1));
      else next.delete(oid);
      return next;
    });
    scrollRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const oid = activeOid ?? selectedOid;
      if (oid !== undefined && visible.merges.has(oid)) {
        event.preventDefault();
        toggleMerge(oid, event.key === "ArrowRight");
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const current = visibleCommits.findIndex(
      (commit) => commit.oid === (activeOid ?? selectedOid),
    );
    const next = Math.min(
      visibleCommits.length - 1,
      Math.max(0, current + (event.key === "ArrowDown" ? 1 : -1)),
    );
    const commit = visibleCommits[next];
    if (commit === undefined) {
      return;
    }
    setSelectedOid(commit.oid);
    setActiveOid(commit.oid);
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
        <div className="flex items-center gap-3">
          <select
            aria-label="History ordering"
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground"
            onChange={(event) =>
              setOrder(
                event.currentTarget.value === "chronological"
                  ? "chronological"
                  : "topological",
              )
            }
            value={order}
          >
            <option value="topological">Topological</option>
            <option value="chronological">Chronological</option>
          </select>
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
        </div>
      </header>
      {scope === undefined || selections === undefined ? null : (
        <HistoryScopeStrip
          onRemove={onRemoveHistoryRef}
          roots={roots ?? []}
          scope={scope}
          selections={selections}
        />
      )}
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
            activeCommitOid === undefined
              ? undefined
              : commitRowId(activeCommitOid)
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
              const commit = visibleCommits[virtualRow.index];
              if (commit === undefined) {
                return null;
              }
              const selected = commit.oid === selectedOid;
              const labels = labelsByOid.get(commit.oid) ?? [];
              return (
                <div
                  aria-label={commitAriaLabel(commit, labels)}
                  aria-posinset={virtualRow.index + 1}
                  aria-selected={selected}
                  aria-setsize={visibleCommits.length}
                  className={`absolute top-0 left-0 grid w-full cursor-default items-center border-border/40 border-b text-xs ${
                    selected
                      ? "bg-primary/12 text-foreground"
                      : "text-foreground hover:bg-accent/35"
                  }`}
                  id={commitRowId(commit.oid)}
                  key={commit.oid}
                  onClick={() => {
                    setSelectedOid(commit.oid);
                    setActiveOid(commit.oid);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedOid(commit.oid);
                      setActiveOid(commit.oid);
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
                  <span className="flex min-w-0 items-center gap-2 pr-4">
                    <span className="min-w-0 truncate">{commit.subject}</span>
                    <CommitRefLabels labels={labels} />
                  </span>
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
        <CommitGraphMergeControls
          commits={visibleCommits}
          horizontalOffset={horizontalOffset}
          laneRows={laneRows}
          merges={visible.merges}
          onToggle={toggleMerge}
          verticalOffset={virtualizer.scrollOffset ?? 0}
          virtualRows={virtualRows}
        />
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

function HistoryScopeStrip({
  onRemove,
  roots,
  scope,
  selections,
}: {
  readonly onRemove: ((target: RepositoryRefTarget) => void) | undefined;
  readonly roots: readonly RepositoryHistoryRefTarget[];
  readonly scope: HistoryScope;
  readonly selections: readonly RepositoryRefTarget[];
}) {
  const detachedHead = roots.find((root) => root.type === "head");
  return (
    <fieldset className="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-border/60 border-b bg-muted/20 px-3 py-1">
      <legend className="sr-only">{scope._tag} history scope</legend>
      <span className="mr-1 text-[10px] text-muted-foreground">Showing</span>
      {selections.map((selection) => (
        <span
          className="inline-flex h-6 max-w-64 items-center gap-1 rounded-sm border border-border/70 bg-background/60 px-2 text-[11px] text-foreground"
          key={scopeSelectionKey(selection)}
        >
          <span className="truncate">{scopeSelectionName(selection)}</span>
          {onRemove === undefined ? null : (
            <button
              aria-label={`Remove ${scopeSelectionName(selection)} from history`}
              className="-mr-1 grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/70"
              onClick={() => onRemove(selection)}
              type="button"
            >
              <IconX aria-hidden="true" className="size-3" />
            </button>
          )}
        </span>
      ))}
      {selections.length === 0 && detachedHead !== undefined ? (
        <span className="inline-flex h-6 items-center rounded-sm border border-border/70 bg-background/60 px-2 text-[11px] text-foreground">
          Detached HEAD
        </span>
      ) : null}
      {selections.length === 0 && detachedHead === undefined ? (
        <span className="text-[11px] text-muted-foreground">No refs</span>
      ) : null}
    </fieldset>
  );
}

function CommitRefLabels({
  labels,
}: {
  readonly labels: readonly RepositoryHistoryRefTarget[];
}) {
  if (labels.length === 0) return null;
  return (
    <span className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
      {labels.map((label) => (
        <span
          className={`max-w-40 truncate rounded-sm border px-1.5 py-0.5 font-mono text-[9px] leading-none ${
            label.type === "tag"
              ? "border-status-connecting/35 bg-status-connecting/10 text-status-connecting"
              : "border-primary/30 bg-primary/8 text-foreground"
          }`}
          key={`${label.type}\0${label.name}`}
        >
          {label.name}
        </span>
      ))}
    </span>
  );
}

function groupRefLabels(refs: readonly RepositoryHistoryRefTarget[]) {
  const labels = new Map<string, RepositoryHistoryRefTarget[]>();
  for (const ref of refs) {
    if (ref.type === "head") continue;
    const current = labels.get(ref.oid);
    if (current === undefined) labels.set(ref.oid, [ref]);
    else current.push(ref);
  }
  return labels;
}

function scopeSelectionName(selection: RepositoryRefTarget) {
  return selection._tag === "RemoteBranch"
    ? `${selection.remote}/${selection.name}`
    : selection.name;
}

function scopeSelectionKey(selection: RepositoryRefTarget) {
  return `${selection._tag}\0${scopeSelectionName(selection)}`;
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

function commitAriaLabel(
  commit: RepositoryCommit,
  labels: readonly RepositoryHistoryRefTarget[],
) {
  const parents = commit.parents.length;
  const refs =
    labels.length === 0
      ? ""
      : `, refs ${labels.map((label) => label.name).join(", ")}`;
  return `${commit.subject}, ${commit.author.name}, ${shortOid(commit.oid)}, ${parents} ${parents === 1 ? "parent" : "parents"}${refs}`;
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
