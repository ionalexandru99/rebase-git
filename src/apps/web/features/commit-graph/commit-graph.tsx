import type {
  RepositoryHistoryRefTarget,
  RepositoryRefs,
  RepositoryRefTarget,
} from "@rebase/contracts";
import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AuthorAvatars,
  type GitHubRepository,
} from "#web/features/author-avatars/index";
import { CommitCommandMenu } from "#web/features/commit-commands/index";
import type {
  CommitGraphHandle,
  CommitGraphHistory,
  CommitGraphViewportAnchor,
} from "#web/features/commit-graph/commit-graph.contract";
import type { CommitGraphSelectionMode } from "#web/features/commit-graph/commit-selection.contract";
import { describeRepositoryHistoryError } from "#web/features/commit-graph/components/commit-graph-messages";
import type { HistoryScope } from "#web/features/commit-graph/history-scope.contract";
import { useCommitGraphCommands } from "#web/features/commit-graph/hooks/use-commit-graph-commands";
import { useCommitGraphPages } from "#web/features/commit-graph/hooks/use-commit-graph-pages";
import { useCommitGraphSelection } from "#web/features/commit-graph/hooks/use-commit-graph-selection";
import { useCommitGraphViewport } from "#web/features/commit-graph/hooks/use-commit-graph-viewport";
import { useGraphColors } from "#web/features/commit-graph/hooks/use-graph-colors";
import { commitGraphGutterWidth } from "#web/features/commit-graph/layout/graph-geometry";
import { graphMetadataColumns } from "#web/features/commit-graph/layout/graph-metrics";
import { graphRefLabels } from "#web/features/commit-graph/layout/graph-ref-labels";
import { RepositoryHistorySearchControls } from "#web/features/history-search/index";
import {
  RepositoryFetchButton,
  RepositoryHistoryFreshnessStatus,
  useRepositoryHistoryFetch,
} from "#web/features/repository-fetch/index";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/index";
import { useRepositoryHistoryOrder } from "#web/features/repository-history/index";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { Button } from "#web-ui/components/ui/button";
import { CommitGraphCanvas } from "#web-ui/features/commit-graph/components/commit-graph-canvas";
import {
  CommitGraphRow,
  commitRowId,
} from "#web-ui/features/commit-graph/components/commit-graph-row";
import {
  CommitGraphFailure,
  CommitGraphLoading,
  CommitGraphPageRetry,
} from "#web-ui/features/commit-graph/components/commit-graph-status";
import { CommitGraphToolbar } from "#web-ui/features/commit-graph/components/commit-graph-toolbar";
import { CommitGraphVirtualWindow } from "#web-ui/features/commit-graph/components/commit-graph-virtual-window";
import { historyLabelTarget } from "#web-ui/features/commit-graph/components/commit-ref-labels";
import { GraphRefAppearance } from "#web-ui/features/commit-graph/components/graph-ref-appearance";
import { HistoryScopeStrip } from "#web-ui/features/commit-graph/components/history-scope-strip";

const emptyRefLabels: readonly RepositoryHistoryRefTarget[] = [];

export function CommitGraph({
  ref,
  historyIdentity,
  onRemoveHistoryRef,
  onRevealHistoryRef,
  onAddHistoryRef,
  onResetHistoryScope,
  history,
  repositoryName,
  roots,
  scope,
  selections,
  githubRepository,
  remoteProviders,
  toolbarActions,
  onOpenDetails,
  onActiveCommitChange,
}: {
  readonly onOpenDetails?: ((oid: string) => void) | undefined;
  readonly onActiveCommitChange?:
    | ((oid: string | undefined) => void)
    | undefined;
  readonly toolbarActions?: ReactNode;
  readonly ref?: Ref<CommitGraphHandle>;
  readonly historyIdentity?:
    | { readonly environmentId: string; readonly repositoryId: string }
    | undefined;
  readonly onAddHistoryRef?: () => void;
  readonly onResetHistoryScope?: (() => void) | undefined;
  readonly onRemoveHistoryRef?: (target: RepositoryRefTarget) => void;
  readonly onRevealHistoryRef?: (target: RepositoryRefTarget) => void;
  readonly history: CommitGraphHistory | undefined;
  readonly repositoryName: string;
  readonly roots: RepositoryHistoryQuery["roots"] | undefined;
  readonly scope?: HistoryScope;
  readonly selections?: readonly RepositoryRefTarget[];
  readonly remoteProviders?: RepositoryRefs["remoteProviders"];
  readonly githubRepository?: GitHubRepository | undefined;
}): JSX.Element {
  const [menuOid, setMenuOid] = useState<string>();
  const [expandedMerges, setExpandedMerges] = useState<
    ReadonlyMap<string, readonly string[]>
  >(new Map());
  const order = useRepositoryHistoryOrder(
    historyIdentity?.environmentId,
    historyIdentity?.repositoryId,
  );
  const connected = useRepositoryScope()?.connected;
  const selectedOidRef = useRef<string | undefined>(undefined);
  const [pageSize, setPageSize] = useState(12);
  const [pendingNavigation, setPendingNavigation] = useState<{
    oid: string;
    offset: number;
    mode: CommitGraphSelectionMode;
  }>();
  const reader = history?.reader;
  const paging = useCommitGraphPages(
    history,
    roots,
    order,
    expandedMerges,
    (): CommitGraphViewportAnchor | undefined => viewport.captureAnchor(),
  );
  const { commits, laneRows, refTargets, historySnapshot, loading } = paging;
  const merges = useMemo(
    () =>
      new Map(
        [...paging.merges.keys()].map((oid) => [
          oid,
          expandedMerges.has(oid)
            ? ("expanded" as const)
            : ("collapsed" as const),
        ]),
      ),
    [paging.merges, expandedMerges],
  );
  const colors = useGraphColors(reader, laneRows, refTargets);
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
  const labelsByOid = useMemo(
    () =>
      graphRefLabels(refTargets, laneRows, paging.snapshot.query?.roots ?? []),
    [refTargets, laneRows, paging.snapshot.query?.roots],
  );
  const gutterWidth = useMemo(
    () => commitGraphGutterWidth(laneRows),
    [laneRows],
  );

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
    merges,
    toggleMerge,
    pageSize,
    startOffset: paging.snapshot.startOffset,
    viewEpoch: paging.snapshot.epoch,
    oldestLoadedOffset: Math.max(0, paging.snapshot.knownEndOffset - 1),
    onSelectionIntent: beginNavigation,
    onActiveCommitChange,
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
  const navigateToOid = async (oid: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const intent = beginNavigation();
    const target = await paging.engine?.jumpToOid(oid, signal);
    signal?.throwIfAborted();
    if (intent !== navigationIntent.current) return;
    if (target === undefined)
      throw new Error("This commit is outside the selected history.");
    for (const root of target.query.roots) {
      if (
        roots?.some(
          (current) => current.type === root.type && current.name === root.name,
        )
      )
        continue;
      const selection = historyLabelTarget(root);
      if (selection !== undefined) onRevealHistoryRef?.(selection);
    }
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
  const focusSelection = () => {
    if (navigation.selection.activeOid !== undefined)
      viewportRef.current?.scrollToIndex(
        navigation.selection.activeIndex + paging.snapshot.startOffset,
      );
    scrollRef.current?.focus();
  };
  useImperativeHandle(ref, () => ({ navigateToOid, focusSelection }));
  selectedOidRef.current = navigation.selection.activeOid;
  const activeCommitOid = visibleOids.includes(
    navigation.selection.activeOid ?? "",
  )
    ? navigation.selection.activeOid
    : undefined;

  const commands = useCommitGraphCommands({
    reader,
    selectedOids: navigation.selection.selectedOids,
    onOpenDetails,
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
    if (
      event.target instanceof Element &&
      event.target.closest("button, input, select, textarea, [role=dialog]") !==
        null
    )
      return;
    navigation.onKeyDown(event);
  };
  const handleRowClick = (event: MouseEvent<HTMLElement>) => {
    const oid = eventCommitOid(event);
    if (oid === undefined) return;
    if (eventTargetMatches(event, "[data-merge-toggle]")) {
      toggleMerge(oid, merges.get(oid) !== "expanded");
      return;
    }
    navigation.onClick(oid, event);
    scrollRef.current?.focus();
  };
  const handleRowDoubleClick = (event: MouseEvent<HTMLElement>) => {
    const oid = eventCommitOid(event);
    if (oid === undefined || eventTargetMatches(event, "button")) return;
    void commands.execute("graph.openDetails", commands.context(oid));
  };
  const handleRowContextMenu = (event: MouseEvent<HTMLElement>) => {
    const oid = eventCommitOid(event);
    if (oid === undefined) return;
    beginNavigation();
    setMenuOid(oid);
    navigation.select(
      oid,
      navigation.selected.has(oid) ? "activate" : "replace",
    );
  };

  return (
    <section
      aria-label="Commit graph"
      className="flex h-full min-h-0 flex-col bg-repository"
    >
      <CommitGraphToolbar.Frame>
        <CommitGraphToolbar.Title repositoryName={repositoryName} />
        {reader === undefined ? null : (
          <RepositoryHistorySearchControls
            reader={reader}
            snapshot={historySnapshot}
            onNavigate={navigateToOid}
            offline={connected === false}
          />
        )}
        <RepositoryFetchButton fetch={fetch} snapshot={historySnapshot} />
        {toolbarActions}
      </CommitGraphToolbar.Frame>
      <GraphRefAppearance
        colors={colors.refs}
        remoteProviders={remoteProviders}
      >
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
        <AuthorAvatars repository={githubRepository}>
          <CommitGraphVirtualWindow
            ref={viewportRef}
            scrollRef={scrollRef}
            commits={commits}
            snapshot={paging.snapshot}
            engine={paging.engine}
            activeOid={activeCommitOid}
            onPageSize={setPageSize}
          >
            {({ viewport, totalHeight, virtualRows }) => (
              <>
                <div className="relative min-h-0 flex-1">
                  <CommitCommandMenu
                    context={
                      menuOid === undefined
                        ? undefined
                        : commands.context(menuOid)
                    }
                    commands={commands.definitions}
                    run={commands.run}
                    tabIndex={0}
                    restoreFocus={() => scrollRef.current?.focus()}
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
                          : paging.snapshot.knownEndOffset + 1
                      }
                      className="absolute inset-0 block h-full w-full overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-primary/70 focus-visible:outline-offset-[-2px]"
                      onKeyDown={handleKeyDown}
                      onClick={handleRowClick}
                      onContextMenu={handleRowContextMenu}
                      onDoubleClick={handleRowDoubleClick}
                      onContextMenuCapture={(event) => {
                        if (
                          !(event.target instanceof Element) ||
                          event.target.closest("tr[aria-rowindex]") === null
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                        }
                      }}
                      ref={scrollRef}
                      role="grid"
                      style={
                        {
                          contain: "layout paint",
                          overflowAnchor: "none",
                          "--graph-row-background": "var(--repository)",
                        } as CSSProperties
                      }
                      tabIndex={0}
                    >
                      <thead
                        className="sticky top-0 z-20 block h-7 bg-repository"
                        style={{ minWidth: gutterWidth + 560 }}
                      >
                        <tr
                          className="grid h-7 items-center border-border/60 border-b text-left text-[.85rem] font-normal text-muted-foreground"
                          style={{
                            gridTemplateColumns: `minmax(0, 1fr) ${graphMetadataColumns}`,
                          }}
                        >
                          <th colSpan={2} className="pl-3 font-normal">
                            Graph / Commit
                          </th>
                          <th className="sticky right-[190px] h-full bg-repository pl-3 font-normal leading-7">
                            Author
                          </th>
                          <th className="sticky right-28 h-full bg-repository font-normal leading-7">
                            SHA
                          </th>
                          <th className="sticky right-0 h-full bg-repository font-normal leading-7">
                            Date
                          </th>
                        </tr>
                      </thead>
                      <tbody
                        className="relative block"
                        style={{
                          height: totalHeight,
                          minWidth: gutterWidth + 560,
                        }}
                      >
                        <CommitGraphCanvas
                          laneRows={laneRows}
                          virtualRows={virtualRows}
                          scrollRef={scrollRef}
                          viewportWidth={viewport.width}
                        />
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
                          const merge = merges.get(commit.oid);
                          return (
                            <CommitGraphRow
                              key={virtualRow.key}
                              commit={commit}
                              labels={
                                labelsByOid.get(commit.oid) ?? emptyRefLabels
                              }
                              lane={laneRows[virtualRow.index]}
                              rowIndex={
                                paging.snapshot.startOffset +
                                virtualRow.index +
                                2
                              }
                              size={virtualRow.size}
                              start={virtualRow.start}
                              selected={navigation.selected.has(commit.oid)}
                              active={
                                navigation.selection.activeOid === commit.oid
                              }
                              merge={merge}
                              busy={
                                merge !== undefined &&
                                merge !== paging.merges.get(commit.oid) &&
                                paging.snapshot.error === undefined
                              }
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </CommitCommandMenu>
                  {loading && commits.length === 0 ? (
                    <CommitGraphLoading />
                  ) : null}
                  {!loading && error !== undefined && commits.length === 0 ? (
                    <CommitGraphFailure
                      error={
                        historySnapshot.error === undefined
                          ? error.message
                          : describeRepositoryHistoryError(
                              historySnapshot.error,
                            )
                      }
                      retry={loadHistory}
                    />
                  ) : null}
                  {!loading && error === undefined && commits.length === 0 ? (
                    <div
                      aria-label="Empty commit history"
                      className="absolute inset-0 grid place-items-center text-[.85rem] text-muted-foreground"
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
        </AuthorAvatars>
      </GraphRefAppearance>
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
          className="m-0 border-border border-t px-3 py-2 text-[.85rem] text-destructive"
          role="alert"
        >
          {commands.error}
        </p>
      )}
      <RepositoryHistoryFreshnessStatus
        snapshot={historySnapshot}
        fetching={fetch.fetching}
        error={fetch.error}
      />
    </section>
  );
}

function eventCommitOid(event: SyntheticEvent) {
  return event.target instanceof Element
    ? event.target.closest<HTMLElement>("tr[data-oid]")?.dataset.oid
    : undefined;
}

function eventTargetMatches(event: SyntheticEvent, selector: string) {
  return (
    event.target instanceof Element && event.target.closest(selector) !== null
  );
}
