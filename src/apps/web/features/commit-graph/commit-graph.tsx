import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
  RepositoryRefTarget,
} from "@rebase/contracts";
import {
  type JSX,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  GraphCommandEnvironment,
  GraphCommandShortcuts,
} from "#web/features/commit-commands/graph-command.contract";
import { useGraphCommands } from "#web/features/commit-commands/use-graph-commands";
import type {
  CommitGraphHandle,
  CommitGraphViewportHandle,
} from "#web/features/commit-graph/commit-graph.contract";
import { describeRepositoryHistoryError } from "#web/features/commit-graph/commit-graph-messages";
import type { CommitGraphSelectionMode } from "#web/features/commit-graph/commit-selection.contract";
import type { HistoryScope } from "#web/features/commit-graph/history-scope.contract";
import { useCommitGraphPages } from "#web/features/commit-graph/use-commit-graph-pages";
import { useCommitGraphSelection } from "#web/features/commit-graph/use-commit-graph-selection";
import { matchesKeyboardShortcut } from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";
import { Button } from "#web-ui/components/ui/button";
import { CommitCommandMenu } from "#web-ui/features/commit-commands/commit-command-menu";
import {
  CommitGraphCanvas,
  commitGraphGutterWidth,
} from "#web-ui/features/commit-graph/commit-graph-canvas";
import { CommitGraphMergeControls } from "#web-ui/features/commit-graph/commit-graph-merge-controls";
import {
  CommitGraphFailure,
  CommitGraphLoading,
  CommitGraphPageRetry,
} from "#web-ui/features/commit-graph/commit-graph-status";
import { CommitGraphVirtualWindow } from "#web-ui/features/commit-graph/commit-graph-virtual-window";
import {
  CommitRefLabels,
  historyLabelTarget,
} from "#web-ui/features/commit-graph/commit-ref-labels";
import { HistoryScopeStrip } from "#web-ui/features/commit-graph/history-scope-strip";

const rowHeight = 36;

export function CommitGraph({
  ref,
  commandEnvironment,
  shortcuts,
  commandsActive = true,
  onRemoveHistoryRef,
  reader,
  repositoryName,
  roots,
  scope,
  selections,
}: {
  readonly ref?: Ref<CommitGraphHandle>;
  readonly commandEnvironment?: GraphCommandEnvironment | undefined;
  readonly shortcuts?: GraphCommandShortcuts | undefined;
  readonly commandsActive?: boolean;
  readonly onRemoveHistoryRef?: (target: RepositoryRefTarget) => void;
  readonly reader: RepositoryHistoryReader | undefined;
  readonly repositoryName: string;
  readonly roots: RepositoryHistoryQuery["roots"] | undefined;
  readonly scope?: HistoryScope;
  readonly selections?: readonly RepositoryRefTarget[];
}): JSX.Element {
  const [menuOid, setMenuOid] = useState<string>();
  const [expandedMerges, setExpandedMerges] = useState<
    ReadonlyMap<string, readonly string[]>
  >(new Map());
  const [order, setOrder] =
    useState<RepositoryHistoryQuery["order"]>("topological");
  const previousOrder = useRef(order);
  const selectedOidRef = useRef<string | undefined>(undefined);
  const pendingViewportAnchor = useRef<ViewportAnchor | undefined>(undefined);
  const scrollRef = useRef<HTMLTableElement>(null);
  const viewportRef = useRef<CommitGraphViewportHandle>(null);
  const [pageSize, setPageSize] = useState(12);
  const committedWindow = useRef<{
    commits: readonly RepositoryCommit[];
    start: number;
  }>({ commits: [], start: 0 });
  const [pendingNavigation, setPendingNavigation] = useState<{
    oid: string;
    offset: number;
    mode: CommitGraphSelectionMode;
  }>();
  const paging = useCommitGraphPages(
    reader,
    roots,
    order,
    expandedMerges,
    () => {
      const current = committedWindow.current;
      let anchor = viewportAnchor(
        scrollRef.current,
        current.commits,
        current.start,
      );
      if (
        previousOrder.current !== order &&
        selectedOidRef.current !== undefined
      )
        anchor = { oid: selectedOidRef.current, offset: 0 };
      previousOrder.current = order;
      pendingViewportAnchor.current = anchor;
      return anchor;
    },
  );
  const { commits, laneRows, refTargets, historySnapshot, loading } = paging;
  const visibleCommits = commits;
  const error = paging.snapshot.error;
  const loadHistory = paging.reload;
  const previousReader = useRef(reader);
  useEffect(() => {
    if (previousReader.current !== reader) {
      previousReader.current = reader;
      setExpandedMerges(new Map());
      setPendingNavigation(undefined);
      pendingViewportAnchor.current = undefined;
      if (scrollRef.current !== null) scrollRef.current.scrollTop = 0;
    }
  }, [reader]);
  useLayoutEffect(() => {
    committedWindow.current = { commits, start: paging.snapshot.startOffset };
    const anchor = pendingViewportAnchor.current;
    const element = scrollRef.current;
    if (anchor === undefined || element === null || loading) return;
    pendingViewportAnchor.current = undefined;
    const index = commits.findIndex((commit) => commit.oid === anchor.oid);
    if (index >= 0)
      element.scrollTop =
        (paging.snapshot.startOffset + index) * rowHeight + anchor.offset;
  }, [commits, paging.snapshot.startOffset, loading]);
  const labelsByOid = useMemo(() => groupRefLabels(refTargets), [refTargets]);
  const gutterWidth = commitGraphGutterWidth(laneRows);

  const toggleMerge = (oid: string, expand: boolean) => {
    const commit = commits.find((candidate) => candidate.oid === oid);
    if (commit === undefined || commit.parents.length < 2) return;
    navigation.select(oid, "activate");
    setExpandedMerges((current) => {
      if (expand === current.has(oid)) return current;
      const next = new Map(current);
      if (expand) next.set(oid, commit.parents.slice(1));
      else next.delete(oid);
      return next;
    });
    scrollRef.current?.focus();
  };

  const visibleOids = useMemo(
    () => visibleCommits.map(({ oid }) => oid),
    [visibleCommits],
  );
  const navigation = useCommitGraphSelection({
    reader,
    oids: visibleOids,
    laneRows,
    merges: paging.merges,
    toggleMerge,
    pageSize,
    startOffset: paging.snapshot.startOffset,
    viewEpoch: paging.snapshot.epoch,
    oldestLoadedOffset: Math.max(0, paging.snapshot.knownEndOffset - 1),
    requestMove: (offset, mode) => {
      void paging.engine?.requestMove(offset).then((target) => {
        if (target !== undefined) setPendingNavigation({ ...target, mode });
      });
    },
    scrollToIndex: (index) =>
      viewportRef.current?.scrollToIndex(index + paging.snapshot.startOffset),
  });
  useLayoutEffect(() => {
    if (
      pendingNavigation === undefined ||
      !visibleOids.includes(pendingNavigation.oid)
    )
      return;
    navigation.select(pendingNavigation.oid, pendingNavigation.mode);
    viewportRef.current?.scrollToIndex(pendingNavigation.offset);
    setPendingNavigation(undefined);
  }, [pendingNavigation, visibleOids, navigation.select]);
  useImperativeHandle(ref, () => ({
    navigateToOid: async (oid) => {
      const target = await paging.engine?.jumpToOid(oid);
      if (target === undefined)
        throw new Error("This commit is outside the selected history.");
      setExpandedMerges((current) => {
        const next = new Map(current);
        for (const edge of target.query.additionalParentEdges ?? [])
          next.set(edge.childOid, [
            ...new Set([...(next.get(edge.childOid) ?? []), edge.parentOid]),
          ]);
        return next;
      });
      setPendingNavigation({ oid, offset: target.offset, mode: "replace" });
      scrollRef.current?.focus();
    },
  }));
  selectedOidRef.current = navigation.selection.activeOid;
  const activeCommitOid = visibleOids.includes(
    navigation.selection.activeOid ?? "",
  )
    ? navigation.selection.activeOid
    : undefined;

  const commands = useGraphCommands({
    environment: commandEnvironment,
    selectedOids: navigation.selection.selectedOids,
    shortcuts,
    active: commandsActive,
    handlers: {
      readCommit: async (oid) => (await reader?.getCommitSummaries([oid]))?.[0],
      writeClipboard: (text) => navigator.clipboard.writeText(text),
      ...(onRemoveHistoryRef === undefined
        ? {}
        : { toggleHistoryRef: onRemoveHistoryRef }),
      actions: {
        "graph.focus": { execute: () => scrollRef.current?.focus() },
        "graph.previousInLane": { execute: () => navigation.moveInLane(-1) },
        "graph.nextInLane": { execute: () => navigation.moveInLane(1) },
      },
    },
  });
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    if (
      (event.key === "ContextMenu" ||
        (event.key === "F10" && event.shiftKey)) &&
      activeCommitOid !== undefined
    ) {
      event.preventDefault();
      const row = document.getElementById(commitRowId(activeCommitOid));
      if (row !== null) {
        const bounds = row.getBoundingClientRect();
        row.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            clientX: bounds.left + 32,
            clientY: bounds.top + bounds.height / 2,
          }),
        );
      }
      return;
    }
    const context = commands.context(activeCommitOid);
    if (context !== undefined && shortcuts !== undefined) {
      const command = commands.registry
        .commands(context)
        .find(
          (candidate) =>
            candidate.enabled &&
            candidate.shortcutId !== undefined &&
            matchesKeyboardShortcut(
              event,
              shortcuts.bindings[candidate.shortcutId],
              shortcuts.platform,
            ),
        );
      if (command !== undefined) {
        event.preventDefault();
        void commands.execute(command.id, context);
        return;
      }
    }
    navigation.onKeyDown(event);
  };
  const refCommandContext = (label: RepositoryHistoryRefTarget) => {
    const target = historyLabelTarget(label);
    return target === undefined
      ? undefined
      : commands.context(undefined, {
          target,
          included: (roots ?? []).some(
            (root) => root.type === label.type && root.name === label.name,
          ),
        });
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
      <CommitGraphVirtualWindow
        ref={viewportRef}
        scrollRef={scrollRef}
        commits={commits}
        snapshot={paging.snapshot}
        engine={paging.engine}
        activeOid={activeCommitOid}
        onPageSize={setPageSize}
      >
        {({
          viewport,
          horizontalOffset,
          verticalOffset,
          totalHeight,
          virtualRows,
          onScroll,
        }) => (
          <>
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
              <CommitCommandMenu
                context={commands.context(menuOid)}
                registry={commands.registry}
                execute={commands.execute}
                shortcuts={shortcuts}
                tabIndex={0}
                restoreFocus={() => scrollRef.current?.focus()}
                refs={(labelsByOid.get(menuOid ?? "") ?? []).flatMap(
                  (label) => {
                    const context = refCommandContext(label);
                    return context === undefined ? [] : [context];
                  },
                )}
              >
                <table
                  aria-activedescendant={
                    activeCommitOid === undefined
                      ? undefined
                      : commitRowId(activeCommitOid)
                  }
                  aria-busy={loading}
                  aria-label="Commit history"
                  aria-multiselectable="true"
                  aria-colcount={4}
                  aria-rowcount={
                    paging.snapshot.hasOlder
                      ? -1
                      : paging.snapshot.knownEndOffset
                  }
                  className="absolute inset-0 block h-full w-full overflow-auto focus-visible:outline-2 focus-visible:outline-primary/70 focus-visible:outline-offset-[-2px]"
                  onKeyDown={handleKeyDown}
                  onContextMenuCapture={(event) => {
                    if (
                      !(event.target instanceof Element) ||
                      event.target.closest("tr[aria-rowindex]") === null
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                  onScroll={onScroll}
                  ref={scrollRef}
                  role="grid"
                  tabIndex={0}
                >
                  <tbody
                    className="relative block"
                    style={{
                      height: totalHeight,
                      minWidth: gutterWidth + 528,
                    }}
                  >
                    {virtualRows.map((virtualRow) => {
                      const commit = visibleCommits[virtualRow.index];
                      if (commit === undefined) {
                        if (
                          error === undefined ||
                          virtualRow.index + paging.snapshot.startOffset !==
                            error.offset
                        )
                          return null;
                        return (
                          <tr
                            key={`retry-${error.offset}`}
                            aria-label="History page unavailable"
                            className="absolute top-0 left-0 block w-full"
                            style={{
                              height: virtualRow.size,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            <td colSpan={4} className="block">
                              <CommitGraphPageRetry
                                error={error.message}
                                retry={() => {
                                  void paging.engine?.retry();
                                }}
                              />
                            </td>
                          </tr>
                        );
                      }
                      const selected = navigation.selected.has(commit.oid);
                      const labels = labelsByOid.get(commit.oid) ?? [];
                      return (
                        <tr
                          key={commit.oid}
                          aria-label={commitAriaLabel(commit, labels)}
                          aria-rowindex={
                            paging.snapshot.startOffset + virtualRow.index + 1
                          }
                          aria-expanded={
                            paging.merges.has(commit.oid)
                              ? paging.merges.get(commit.oid) === "expanded"
                              : undefined
                          }
                          aria-selected={selected}
                          className={`absolute top-0 left-0 grid w-full cursor-default items-center border-border/40 border-b text-xs data-[active=true]:outline data-[active=true]:outline-1 data-[active=true]:outline-primary/70 data-[active=true]:outline-offset-[-2px] ${
                            selected
                              ? "bg-primary/12 text-foreground"
                              : "text-foreground hover:bg-accent/35"
                          }`}
                          data-active={
                            navigation.selection.activeOid === commit.oid
                              ? "true"
                              : undefined
                          }
                          id={commitRowId(commit.oid)}
                          onClick={(event) => {
                            navigation.onClick(commit.oid, event);
                            scrollRef.current?.focus();
                          }}
                          onContextMenu={() => {
                            setMenuOid(commit.oid);
                            navigation.select(
                              commit.oid,
                              selected ? "activate" : "replace",
                            );
                          }}
                          onKeyDown={handleKeyDown}
                          style={{
                            gridTemplateColumns: `${gutterWidth}px minmax(16rem, 1fr) 10rem 7rem`,
                            height: virtualRow.size,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                          tabIndex={-1}
                        >
                          <td
                            role="gridcell"
                            tabIndex={-1}
                            aria-label={`${commit.parents.length} parents`}
                          />
                          <td
                            role="gridcell"
                            tabIndex={-1}
                            className="flex min-w-0 items-center gap-2 pr-4"
                          >
                            <span className="min-w-0 truncate">
                              {commit.subject}
                            </span>
                            <CommitRefLabels
                              labels={labels}
                              context={refCommandContext}
                              registry={commands.registry}
                              execute={commands.execute}
                              restoreFocus={() => scrollRef.current?.focus()}
                            />
                          </td>
                          <td
                            role="gridcell"
                            tabIndex={-1}
                            className="truncate pr-4 text-muted-foreground"
                          >
                            {commit.author.name}
                          </td>
                          <td
                            role="gridcell"
                            tabIndex={-1}
                            className="truncate pr-3 text-muted-foreground"
                          >
                            <time
                              dateTime={new Date(
                                commit.committer.timestampSeconds * 1_000,
                              ).toISOString()}
                            >
                              {formatCommitDate(
                                commit.committer.timestampSeconds,
                              )}
                            </time>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CommitCommandMenu>
              {commits.length > 0 ? (
                <CommitGraphCanvas
                  height={viewport.height}
                  horizontalOffset={horizontalOffset}
                  laneRows={laneRows}
                  virtualRows={virtualRows}
                  verticalOffset={verticalOffset}
                  width={Math.min(gutterWidth, viewport.width)}
                />
              ) : null}
              <CommitGraphMergeControls
                commits={visibleCommits}
                horizontalOffset={horizontalOffset}
                laneRows={laneRows}
                merges={paging.merges}
                onToggle={toggleMerge}
                verticalOffset={verticalOffset}
                virtualRows={virtualRows}
              />
              {loading && commits.length === 0 ? <CommitGraphLoading /> : null}
              {!loading && error !== undefined && commits.length === 0 ? (
                <CommitGraphFailure
                  error={
                    historySnapshot.error === undefined
                      ? error.message
                      : describeRepositoryHistoryError(historySnapshot.error)
                  }
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
          </>
        )}
      </CommitGraphVirtualWindow>
      {error !== undefined &&
      commits.length > 0 &&
      error.offset < paging.snapshot.endOffset ? (
        <CommitGraphPageRetry
          error={error.message}
          retry={() => {
            void paging.engine?.retry();
          }}
        />
      ) : null}
      {loading && commits.length > 0 ? (
        <p
          className="m-0 shrink-0 border-border border-t px-3 py-1 text-xs text-muted-foreground"
          role="status"
        >
          Loading history…
        </p>
      ) : null}
      {commands.error === undefined ? null : (
        <p
          className="m-0 border-border border-t px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {commands.error}
        </p>
      )}
    </section>
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
  element: HTMLElement | null,
  commits: readonly RepositoryCommit[],
  startOffset = 0,
): ViewportAnchor | undefined {
  if (element === null || element.scrollTop <= 0) {
    return undefined;
  }
  const index = Math.floor(element.scrollTop / rowHeight);
  const commit = commits[index - startOffset];
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
