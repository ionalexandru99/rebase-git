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
import type {
  CommitGraphHandle,
  CommitGraphViewportAnchor,
} from "#web/features/commit-graph/commit-graph.contract";
import type { CommitGraphSelectionMode } from "#web/features/commit-graph/commit-selection.contract";
import { describeRepositoryHistoryError } from "#web/features/commit-graph/components/commit-graph-messages";
import type { HistoryScope } from "#web/features/commit-graph/history-scope.contract";
import { useCommitGraphCommands } from "#web/features/commit-graph/hooks/use-commit-graph-commands";
import { useCommitGraphPages } from "#web/features/commit-graph/hooks/use-commit-graph-pages";
import { useCommitGraphSelection } from "#web/features/commit-graph/hooks/use-commit-graph-selection";
import { useCommitGraphViewport } from "#web/features/commit-graph/hooks/use-commit-graph-viewport";
import type { RepositoryHistoryCacheDialogProps } from "#web/features/repository-history/diagnostics/components/repository-history-cache-dialog.contract";
import { useRepositoryHistoryFetch } from "#web/features/repository-history/freshness/hooks/use-repository-history-fetch";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryHistorySearchActions } from "#web/features/repository-history/search/components/repository-history-search-controls.contract";
import { Button } from "#web-ui/components/ui/button";
import { CommitCommandMenu } from "#web-ui/features/commit-commands/commit-command-menu";
import {
  CommitGraphCanvas,
  commitGraphGutterWidth,
} from "#web-ui/features/commit-graph/components/commit-graph-canvas";
import { CommitGraphCommitCells } from "#web-ui/features/commit-graph/components/commit-graph-commit-cells";
import { CommitGraphMergeControls } from "#web-ui/features/commit-graph/components/commit-graph-merge-controls";
import {
  CommitGraphFailure,
  CommitGraphLoading,
  CommitGraphPageRetry,
} from "#web-ui/features/commit-graph/components/commit-graph-status";
import { CommitGraphToolbar } from "#web-ui/features/commit-graph/components/commit-graph-toolbar";
import { CommitGraphToolbarDialogs } from "#web-ui/features/commit-graph/components/commit-graph-toolbar-dialogs";
import { CommitGraphVirtualWindow } from "#web-ui/features/commit-graph/components/commit-graph-virtual-window";
import { HistoryScopeStrip } from "#web-ui/features/commit-graph/components/history-scope-strip";
import { RepositoryHistoryFreshnessStatus } from "#web-ui/features/repository-history/freshness/components/repository-history-freshness-status";
import { RepositoryHistorySearchControls } from "#web-ui/features/repository-history/search/components/repository-history-search-controls";

const emptyRefLabels: readonly RepositoryHistoryRefTarget[] = [];

export function CommitGraph({
  ref,
  commandEnvironment,
  shortcuts,
  commandsActive = true,
  onCacheChanged,
  onRemoveHistoryRef,
  onAddHistoryRef,
  onResetHistoryScope,
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
  readonly onCacheChanged?: RepositoryHistoryCacheDialogProps["onCacheChanged"];
  readonly onAddHistoryRef?: () => void;
  readonly onResetHistoryScope?: () => void;
  readonly onRemoveHistoryRef?: (target: RepositoryRefTarget) => void;
  readonly reader: RepositoryHistoryReader | undefined;
  readonly repositoryName: string;
  readonly roots: RepositoryHistoryQuery["roots"] | undefined;
  readonly scope?: HistoryScope;
  readonly selections?: readonly RepositoryRefTarget[];
}): JSX.Element {
  const searchRef = useRef<RepositoryHistorySearchActions>(null);
  const [menuOid, setMenuOid] = useState<string>();
  const [expandedMerges, setExpandedMerges] = useState<
    ReadonlyMap<string, readonly string[]>
  >(new Map());
  const [order, setOrder] =
    useState<RepositoryHistoryQuery["order"]>("topological");
  const selectedOidRef = useRef<string | undefined>(undefined);
  const [pageSize, setPageSize] = useState(12);
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
    (): CommitGraphViewportAnchor | undefined => viewport.captureAnchor(),
  );
  const { commits, laneRows, refTargets, historySnapshot, loading } = paging;
  const viewport = useCommitGraphViewport({
    reader,
    order,
    selectedOidRef,
    commits,
    startOffset: paging.snapshot.startOffset,
    loading,
  });
  const { scrollRef, viewportRef } = viewport;
  const fetch = useRepositoryHistoryFetch(reader, historySnapshot);
  const visibleCommits = commits;
  const error = paging.snapshot.error;
  const loadHistory = paging.reload;
  const previousReader = useRef(reader);
  useEffect(() => {
    if (previousReader.current !== reader) {
      previousReader.current = reader;
      setExpandedMerges(new Map());
      setPendingNavigation(undefined);
    }
  }, [reader]);
  const labelsByOid = useMemo(() => groupRefLabels(refTargets), [refTargets]);
  const gutterWidth = commitGraphGutterWidth(laneRows);

  const navigationIntent = useRef(0);
  const beginNavigation = () => {
    const intent = ++navigationIntent.current;
    paging.engine?.cancelNavigation();
    setPendingNavigation(undefined);
    return intent;
  };

  const toggleMerge = (oid: string, expand: boolean) => {
    const commit = commits.find((candidate) => candidate.oid === oid);
    if (commit === undefined || commit.parents.length < 2) return;
    beginNavigation();
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
    query: paging.snapshot.query,
    loading: paging.loading,
    oids: visibleOids,
    laneRows,
    merges: paging.merges,
    toggleMerge,
    pageSize,
    startOffset: paging.snapshot.startOffset,
    viewEpoch: paging.snapshot.epoch,
    oldestLoadedOffset: Math.max(0, paging.snapshot.knownEndOffset - 1),
    onSelectionIntent: beginNavigation,
    requestLaneMove: (offset, direction) => {
      const intent = beginNavigation();
      void paging.engine?.requestLaneMove(offset, direction).then((target) => {
        if (intent === navigationIntent.current && target !== undefined)
          setPendingNavigation({ ...target, mode: "replace" });
      });
    },
    requestMove: (offset, mode) => {
      const intent = beginNavigation();
      void paging.engine?.requestMove(offset).then((target) => {
        if (intent === navigationIntent.current && target !== undefined)
          setPendingNavigation({ ...target, mode });
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
  }, [pendingNavigation, visibleOids, navigation.select, viewportRef]);
  const navigateToOid = async (oid: string) => {
    const intent = beginNavigation();
    const target = await paging.engine?.jumpToOid(oid);
    if (intent !== navigationIntent.current) return;
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
  };
  useImperativeHandle(ref, () => ({ navigateToOid }));
  selectedOidRef.current = navigation.selection.activeOid;
  const activeCommitOid = visibleOids.includes(
    navigation.selection.activeOid ?? "",
  )
    ? navigation.selection.activeOid
    : undefined;

  const {
    commands,
    binding,
    fetchAction,
    handleCommandKeyDown,
    refCommandContext,
  } = useCommitGraphCommands({
    commandEnvironment,
    shortcuts,
    commandsActive,
    reader,
    historySnapshot,
    fetch,
    navigation,
    activeCommitOid,
    scrollRef,
    searchRef,
    roots,
    onRemoveHistoryRef,
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
    handleCommandKeyDown(event);
    if (event.defaultPrevented) return;
    navigation.onKeyDown(event);
  };
  const restoreGraphFocus = () => scrollRef.current?.focus();

  return (
    <section
      aria-label="Commit graph"
      onKeyDown={handleCommandKeyDown}
      className="flex h-full min-h-0 flex-col bg-repository"
    >
      <CommitGraphToolbar.Frame>
        <CommitGraphToolbar.Title repositoryName={repositoryName} />
        {reader === undefined ? null : (
          <RepositoryHistorySearchControls
            ref={searchRef}
            reader={reader}
            snapshot={historySnapshot}
            onNavigate={navigateToOid}
            offline={commandEnvironment?.connected === false}
            bindings={{
              open: binding("graph.search"),
              next: binding("graph.nextMatch"),
              previous: binding("graph.previousMatch"),
            }}
          />
        )}
        <CommitGraphToolbar.Order order={order} onOrderChange={setOrder} />
        <CommitGraphToolbar.Fetch
          fetchAction={fetchAction}
          fetching={fetch.fetching}
        />
        <CommitGraphToolbar.Options
          fetchSettingsAvailable={reader !== undefined}
          cacheAvailable={
            reader !== undefined && commandEnvironment !== undefined
          }
        />
      </CommitGraphToolbar.Frame>
      <CommitGraphToolbarDialogs
        repositoryName={repositoryName}
        reader={reader}
        snapshot={historySnapshot}
        offline={commandEnvironment?.connected === false}
        canConfigure={
          commandEnvironment?.connected === true &&
          commandEnvironment.capabilities.has("repository.write")
        }
        cache={
          commandEnvironment === undefined
            ? undefined
            : {
                identity: {
                  environmentId: commandEnvironment.environmentId,
                  repositoryId: commandEnvironment.logicalRepositoryId,
                },
                onCacheChanged: onCacheChanged ?? (() => {}),
              }
        }
      />
      {scope === undefined || selections === undefined ? null : (
        <HistoryScopeStrip
          onRemove={onRemoveHistoryRef}
          onAdd={onAddHistoryRef}
          onReset={onResetHistoryScope}
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
            <div className="h-8 shrink-0 overflow-hidden">
              <div
                className="grid h-8 shrink-0 items-center border-border/60 border-b text-[11px] text-muted-foreground"
                style={{
                  gridTemplateColumns: `${gutterWidth}px minmax(15rem, 1fr) 5.5rem 8rem 6.5rem`,
                  width: Math.max(viewport.width, gutterWidth + 560),
                  transform: `translateX(${-horizontalOffset}px)`,
                }}
              >
                <span className="px-3">Graph</span>
                <span>Commit</span>
                <span>SHA</span>
                <span>Author</span>
                <span>Date</span>
              </div>
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
                  aria-colcount={5}
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
                  style={{ contain: "layout paint" }}
                  tabIndex={0}
                >
                  <tbody
                    className="relative block"
                    style={{
                      height: totalHeight,
                      minWidth: gutterWidth + 560,
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
                            <td colSpan={5} className="block">
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
                      const labels =
                        labelsByOid.get(commit.oid) ?? emptyRefLabels;
                      return (
                        <tr
                          key={virtualRow.key}
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
                            beginNavigation();
                            setMenuOid(commit.oid);
                            navigation.select(
                              commit.oid,
                              selected ? "activate" : "replace",
                            );
                          }}
                          onKeyDown={handleKeyDown}
                          style={{
                            gridTemplateColumns: `${gutterWidth}px minmax(15rem, 1fr) 5.5rem 8rem 6.5rem`,
                            height: virtualRow.size,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                          tabIndex={-1}
                        >
                          <CommitGraphCommitCells
                            commit={commit}
                            labels={labels}
                            context={refCommandContext}
                            registry={commands.registry}
                            execute={commands.execute}
                            restoreFocus={restoreGraphFocus}
                          />
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
                  aria-label="Empty commit history"
                  className="absolute inset-0 grid place-items-center text-sm text-muted-foreground"
                  role="status"
                >
                  {(roots?.length ?? 0) > 0
                    ? "No cached commits in this history scope."
                    : "This repository has no commits yet."}
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
      {error === undefined && historySnapshot.synchronization === "stale" ? (
        <Button
          className="self-start"
          onClick={loadHistory}
          size="sm"
          variant="ghost"
        >
          Stale. Retry
        </Button>
      ) : null}
      {commands.error === undefined ? null : (
        <p
          className="m-0 border-border border-t px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {commands.error}
        </p>
      )}
      <RepositoryHistoryFreshnessStatus
        selectedCount={navigation.selected.size}
        snapshot={historySnapshot}
        fetchAction={fetchAction}
        fetching={fetch.fetching}
        error={fetch.error}
      />
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
