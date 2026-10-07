import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { RepositoryHistoryRefTarget } from "#contracts/repository-history/repository-history.contract.ts";
import type { RepositoryRefs } from "#contracts/repository-refs/repository-refs.contract.ts";
import { type Action, runAction } from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { ScrollTopButton } from "#web/components/ui/scroll-top-button.tsx";
import type { CherryPick } from "#web/features/cherry-pick/cherry-pick-menu.tsx";
import {
  CommitActionMenu,
  useCommitActions,
} from "#web/features/commit-graph/commit-actions.tsx";
import { CommitGraphCanvas } from "#web/features/commit-graph/components/commit-graph-canvas.tsx";
import {
  CommitGraphRow,
  commitRowId,
} from "#web/features/commit-graph/components/commit-graph-row.tsx";
import {
  CommitGraphFailure,
  CommitGraphLoading,
  CommitGraphPageRetry,
} from "#web/features/commit-graph/components/commit-graph-status.tsx";
import {
  type CommitGraphViewportHandle,
  CommitGraphVirtualWindow,
} from "#web/features/commit-graph/components/commit-graph-virtual-window.tsx";
import {
  GraphRefAppearance,
  graphRefLabels,
} from "#web/features/commit-graph/components/commit-ref-labels.tsx";
import { HistoryScopeStrip } from "#web/features/commit-graph/components/history-scope-strip.tsx";
import {
  UncommittedChangesLine,
  UncommittedChangesRow,
  uncommittedLink,
  useUncommittedChanges,
} from "#web/features/commit-graph/components/uncommitted-changes-row.tsx";
import { useCommitGraphView } from "#web/features/commit-graph/hooks/use-commit-graph-view.ts";
import { useGraphColors } from "#web/features/commit-graph/layout/graph-colors.ts";
import {
  commitGraphGutterWidth,
  graphAuthorCellClassName,
  graphAuthorNameClassName,
  graphHeaderHeight,
  graphMetadataClassName,
  graphMetadataColumns,
  graphMinimumWidth,
  graphRowHeight,
  graphShaCellClassName,
} from "#web/features/commit-graph/layout/graph-geometry.ts";
import type {
  HistoryScope,
  HistorySelection,
} from "#web/features/commit-graph/scope/history-scope.ts";
import type { CompareActions } from "#web/features/comparison/comparison.ts";
import { RepositoryHistorySearchControls } from "#web/features/history-search/components/repository-history-search-controls.tsx";
import type { MergeActions } from "#web/features/merge/merge-actions.ts";
import type { RebaseActions } from "#web/features/rebase/rebase-actions.ts";
import type { RewriteCommits } from "#web/features/rebase/rewrite-commits.tsx";
import {
  describeHistoryFailure,
  type RepositoryHistory,
} from "#web/features/repository-history/repository-history.ts";
import type { ResetActions } from "#web/features/reset/reset-actions.tsx";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

export interface CommitGraphHandle {
  readonly focusSelection: () => void;
  readonly navigateToOid: (oid: string) => Promise<void>;
  readonly followOid: (oid: string) => void;
}

const emptyRefLabels: readonly RepositoryHistoryRefTarget[] = [];

export function CommitGraph({
  ref,
  historyIdentity,
  onRemoveHistoryRef,
  onRevealHistoryRef,
  onResetHistoryScope,
  history,
  repositoryName,
  roots,
  scope,
  selections,
  remoteProviders,
  titleActions,
  toolbarActions,
  toolbarInset = false,
  merge,
  rebase,
  reset,
  compare,
  cherryPick,
  rewrite,
  onOpenDetails,
  onOpenChanges,
  onActiveCommitChange,
}: {
  readonly merge?: MergeActions | undefined;
  readonly rebase?: RebaseActions | undefined;
  readonly reset?: ResetActions | undefined;
  readonly compare?: CompareActions | undefined;
  readonly cherryPick?: CherryPick | undefined;
  readonly rewrite?: RewriteCommits | undefined;
  readonly onOpenDetails?: ((oid: string) => void) | undefined;
  readonly onOpenChanges?: (() => void) | undefined;
  readonly onActiveCommitChange?:
    | ((oid: string | undefined) => void)
    | undefined;
  readonly titleActions?: ReactNode;
  readonly toolbarActions?: ReactNode;
  readonly toolbarInset?: boolean;
  readonly ref?: Ref<CommitGraphHandle>;
  readonly historyIdentity?:
    | { readonly environmentId: string; readonly repositoryId: string }
    | undefined;
  readonly onResetHistoryScope?: (() => void) | undefined;
  readonly onRemoveHistoryRef?: (target: HistorySelection) => void;
  readonly onRevealHistoryRef?: (target: HistorySelection) => void;
  readonly history: RepositoryHistory | undefined;
  readonly repositoryName: string;
  readonly roots: readonly RepositoryHistoryRefTarget[] | undefined;
  readonly scope?: HistoryScope;
  readonly selections?: readonly HistorySelection[];
  readonly remoteProviders?: RepositoryRefs["remoteProviders"];
}): JSX.Element {
  const [menuOid, setMenuOid] = useState<string>();
  const connected = useRepositoryScope()?.connected;
  const scrollRef = useRef<HTMLTableElement>(null);
  const viewportRef = useRef<CommitGraphViewportHandle>(null);
  const {
    snapshot,
    rows,
    scopeQuery,
    start,
    total,
    windowRows,
    laneRows,
    oids,
    merges,
    shownMerges,
    resident,
    navigation,
    activeCommitOid,
    beginNavigation,
    toggleMerge,
    navigateToOid,
    focusSelection,
    onRange,
    setPageSize,
  } = useCommitGraphView({
    history,
    historyIdentity,
    roots,
    scrollRef,
    viewportRef,
    onRevealHistoryRef,
    onActiveCommitChange,
  });
  const colors = useGraphColors(history, laneRows, snapshot.refTargets);
  const labelsByOid = graphRefLabels(
    snapshot.refTargets,
    laneRows,
    roots ?? [],
  );
  const gutterWidth = commitGraphGutterWidth(laneRows);
  useImperativeHandle(ref, () => ({
    navigateToOid,
    followOid: (oid) =>
      void navigateToOid(oid, undefined, true).catch(() => undefined),
    focusSelection,
  }));
  const uncommitted = useUncommittedChanges();
  const head = uncommitted?.head;
  const link =
    head === undefined ? undefined : uncommittedLink(laneRows, start, head);
  const headerRows = uncommitted === undefined ? 1 : 2;
  const headerHeight = graphHeaderHeight + (headerRows - 1) * graphRowHeight;

  const [previewing, setPreviewing] = useState(false);
  const commands = useCommitActions({
    history,
    scope: scopeQuery,
    cherryPick,
    merge,
    rebase: rebase && {
      actionFor: (oid) => highlighted(rebase.actionFor(oid), setPreviewing),
    },
    rewrite,
    reset,
    compare,
    onOpenDetails,
  });
  const moving = new Set(
    previewing && menuOid !== undefined ? rebase?.moving(menuOid) : [],
  );
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
          new globalThis.MouseEvent("contextmenu", {
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
    const farEdgeTarget =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-far-to]")?.dataset.farTo
        : undefined;
    if (farEdgeTarget !== undefined) {
      void navigateToOid(farEdgeTarget).catch(() => undefined);
      return;
    }
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
    runAction(commands.actionsFor(oid).find(({ id }) => id === "openDetails"));
  };
  const handleRowContextMenu = (event: MouseEvent<HTMLElement>) => {
    const oid = eventCommitOid(event);
    const index = oid === undefined ? undefined : resident.indexOf(oid);
    if (oid === undefined || index === undefined) return;
    beginNavigation();
    setMenuOid(oid);
    merge?.inspect(oid);
    rebase?.inspect(oid);
    const selection = navigation.selected.has(oid)
      ? [...navigation.selected]
      : [oid];
    cherryPick?.open(selection, scopeQuery);
    rewrite?.open(selection, scopeQuery);
    navigation.select(
      oid,
      index,
      navigation.selected.has(oid) ? "activate" : "replace",
    );
  };

  const failure =
    rows.failure ??
    (snapshot.status === "error" ? snapshot.failure : undefined);
  const loading =
    history === undefined ||
    scopeQuery === undefined ||
    rows.loading ||
    snapshot.status === "loading";
  const retry = () => {
    history?.synchronize();
    rows.retry();
  };
  return (
    <section
      aria-label="Commit graph"
      className="flex h-full min-h-0 flex-col bg-repository"
    >
      <CommitGraphToolbar.Frame inset={toolbarInset}>
        <CommitGraphToolbar.Title repositoryName={repositoryName}>
          {titleActions}
        </CommitGraphToolbar.Title>
        {history === undefined ? null : (
          <RepositoryHistorySearchControls
            history={history}
            snapshot={snapshot}
            onNavigate={navigateToOid}
            offline={connected === false}
          />
        )}
        {toolbarActions}
      </CommitGraphToolbar.Frame>
      <GraphRefAppearance
        colors={colors.refs}
        remoteProviders={remoteProviders}
      >
        {scope === undefined || selections === undefined ? null : (
          <HistoryScopeStrip
            onRemove={onRemoveHistoryRef}
            onReset={onResetHistoryScope}
            roots={roots ?? []}
            scope={scope}
            selections={selections}
          />
        )}
        <CommitGraphVirtualWindow
          ref={viewportRef}
          scrollRef={scrollRef}
          headerHeight={headerHeight}
          total={total}
          start={start}
          oids={oids}
          activeIndex={
            activeCommitOid === undefined
              ? undefined
              : navigation.selection.activeIndex
          }
          onRange={onRange}
          onPageSize={setPageSize}
        >
          {({ viewport, totalHeight, flowStart, virtualRows }) => (
            <div className="relative min-h-0 flex-1">
              <CommitActionMenu
                actions={
                  menuOid === undefined
                    ? undefined
                    : commands.actionsFor(
                        menuOid,
                        navigation.selected.has(menuOid)
                          ? [...navigation.selected]
                          : [menuOid],
                      )
                }
                tabIndex={0}
                restoreFocus={() => {
                  setPreviewing(false);
                  scrollRef.current?.focus();
                }}
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
                  aria-rowcount={total + headerRows}
                  className="@container/graph absolute inset-0 block h-full w-full overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-primary/70 focus-visible:outline-offset-[-2px]"
                  onKeyDown={handleKeyDown}
                  onMouseDown={(event) => {
                    if (event.shiftKey) event.preventDefault();
                  }}
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
                    className={`sticky top-0 z-20 block bg-repository ${graphMetadataClassName}`}
                    style={{
                      height: headerHeight,
                      minWidth: graphMinimumWidth(gutterWidth),
                    }}
                  >
                    <tr
                      className="grid h-7 items-center border-border/60 border-b text-left text-body font-normal text-muted-foreground"
                      style={{
                        gridTemplateColumns: `minmax(0, 1fr) ${graphMetadataColumns}`,
                      }}
                    >
                      <th colSpan={2} className="pl-3 font-normal">
                        Graph / Commit
                      </th>
                      <th
                        className={`${graphAuthorCellClassName} h-full bg-repository pl-3 font-normal leading-7`}
                      >
                        <span className={graphAuthorNameClassName}>Author</span>
                      </th>
                      <th
                        className={`${graphShaCellClassName} h-full bg-repository font-normal leading-7`}
                      >
                        SHA
                      </th>
                      <th className="sticky right-0 h-full bg-repository font-normal leading-7">
                        Date
                      </th>
                    </tr>
                    {uncommitted === undefined ? null : (
                      <UncommittedChangesRow
                        changes={uncommitted}
                        link={link}
                        onOpen={onOpenChanges}
                      />
                    )}
                  </thead>
                  <tbody
                    className={`relative block ${graphMetadataClassName}`}
                    style={{
                      height: totalHeight,
                      minWidth: graphMinimumWidth(gutterWidth),
                    }}
                  >
                    <CommitGraphCanvas
                      laneRows={laneRows}
                      offset={start}
                      virtualRows={virtualRows}
                      scrollRef={scrollRef}
                      viewportWidth={viewport.width}
                    />
                    {link === undefined ? null : (
                      <UncommittedChangesLine link={link} />
                    )}
                    <tr inert className="block" style={{ height: flowStart }} />
                    {virtualRows.map((virtualRow) => {
                      const row = windowRows[virtualRow.index];
                      if (row === undefined) return null;
                      const { commit } = row;
                      const merge = merges.get(commit.oid);
                      return (
                        <CommitGraphRow
                          key={virtualRow.key}
                          commit={commit}
                          labels={labelsByOid.get(commit.oid) ?? emptyRefLabels}
                          lane={row.lane}
                          rowIndex={start + virtualRow.index + headerRows + 1}
                          start={virtualRow.start}
                          selected={navigation.selected.has(commit.oid)}
                          order={commands.preview.indexOf(commit.oid) + 1}
                          active={navigation.selection.activeOid === commit.oid}
                          merge={merge}
                          busy={
                            merge !== undefined &&
                            merge !== shownMerges.get(commit.oid) &&
                            failure === undefined
                          }
                          reserve={
                            link !== undefined &&
                            start + virtualRow.index < link.index
                              ? link.x + 12
                              : 0
                          }
                          mark={
                            moving.has(commit.oid)
                              ? "moving"
                              : previewing && commit.oid === menuOid
                                ? "base"
                                : undefined
                          }
                        />
                      );
                    })}
                  </tbody>
                </table>
              </CommitActionMenu>
              <ScrollTopButton
                className="absolute top-0.5 right-1 z-30"
                region={scrollRef}
              />
              {loading && windowRows.length === 0 && failure === undefined ? (
                <CommitGraphLoading />
              ) : null}
              {failure !== undefined && windowRows.length === 0 ? (
                <CommitGraphFailure
                  error={describeHistoryFailure(failure)}
                  retry={retry}
                />
              ) : null}
              {!loading && failure === undefined && total === 0 ? (
                <div
                  aria-label="Empty commit history"
                  className="pointer-events-none absolute inset-0 grid place-items-center text-body text-muted-foreground"
                  role="status"
                >
                  {(roots?.length ?? 0) > 0
                    ? "No cached commits in this history scope."
                    : "This repository has no commits yet."}
                </div>
              ) : null}
            </div>
          )}
        </CommitGraphVirtualWindow>
      </GraphRefAppearance>
      {failure !== undefined && windowRows.length > 0 ? (
        <CommitGraphPageRetry
          error={describeHistoryFailure(failure)}
          retry={retry}
        />
      ) : null}
      {failure === undefined && snapshot.synchronization === "stale" ? (
        <Button
          className="self-start"
          onClick={retry}
          size="sm"
          variant="ghost"
        >
          Refresh history
        </Button>
      ) : null}
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

function Frame({
  inset,
  children,
}: {
  readonly inset: boolean;
  readonly children: ReactNode;
}) {
  return (
    <header
      className={`flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-border/60 border-b py-2 pl-3 ${inset ? "pr-20" : "pr-3"}`}
    >
      {children}
    </header>
  );
}
function Title({
  repositoryName,
  children,
}: {
  readonly repositoryName: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="mr-auto flex min-w-0 items-center gap-2">
      <h1 className="min-w-0 max-w-48 truncate text-body font-semibold text-foreground">
        {repositoryName}
      </h1>
      {children}
    </div>
  );
}
const CommitGraphToolbar = { Frame, Title };

function highlighted<Id extends string>(
  action: Action<Id> | undefined,
  onHighlight: (highlighted: boolean) => void,
): Action<Id> | undefined {
  return (
    action && {
      ...action,
      onHighlight,
      ...(action.submenu === undefined
        ? {}
        : {
            submenu: {
              ...action.submenu,
              actions: action.submenu.actions.map((choice) => ({
                ...choice,
                onHighlight,
              })),
            },
          }),
    }
  );
}
