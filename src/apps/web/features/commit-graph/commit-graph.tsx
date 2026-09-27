import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RepositoryHistoryRefTarget } from "#contracts/repository-history/repository-history.contract.ts";
import type { RepositoryRefs } from "#contracts/repository-refs/repository-refs.contract.ts";
import { runAction } from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { AuthorAvatars } from "#web/features/author-avatars/author-avatar.tsx";
import type { GitHubRepository } from "#web/features/author-avatars/author-avatar-source.ts";
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
import { useCommitGraphView } from "#web/features/commit-graph/hooks/use-commit-graph-view.ts";
import { useGraphColors } from "#web/features/commit-graph/layout/graph-colors.ts";
import {
  commitGraphGutterWidth,
  graphMetadataColumns,
} from "#web/features/commit-graph/layout/graph-geometry.ts";
import type {
  HistoryScope,
  HistorySelection,
} from "#web/features/commit-graph/scope/history-scope.ts";
import { RepositoryHistorySearchControls } from "#web/features/history-search/components/repository-history-search-controls.tsx";
import {
  describeHistoryFailure,
  type RepositoryHistory,
} from "#web/features/repository-history/repository-history.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

export interface CommitGraphHandle {
  readonly focusSelection: () => void;
  readonly navigateToOid: (oid: string) => Promise<void>;
}

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
  readonly onRemoveHistoryRef?: (target: HistorySelection) => void;
  readonly onRevealHistoryRef?: (target: HistorySelection) => void;
  readonly history: RepositoryHistory | undefined;
  readonly repositoryName: string;
  readonly roots: readonly RepositoryHistoryRefTarget[] | undefined;
  readonly scope?: HistoryScope;
  readonly selections?: readonly HistorySelection[];
  readonly remoteProviders?: RepositoryRefs["remoteProviders"];
  readonly githubRepository?: GitHubRepository | undefined;
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
  const labelsByOid = useMemo(
    () => graphRefLabels(snapshot.refTargets, laneRows, roots ?? []),
    [snapshot.refTargets, laneRows, roots],
  );
  const gutterWidth = useMemo(
    () => commitGraphGutterWidth(laneRows),
    [laneRows],
  );
  useImperativeHandle(ref, () => ({ navigateToOid, focusSelection }));

  const commands = useCommitActions({ history, onOpenDetails });
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
      <CommitGraphToolbar.Frame>
        <CommitGraphToolbar.Title repositoryName={repositoryName} />
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
            {({ viewport, totalHeight, virtualRows }) => (
              <div className="relative min-h-0 flex-1">
                <CommitActionMenu
                  actions={
                    menuOid === undefined
                      ? undefined
                      : commands.actionsFor(menuOid)
                  }
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
                    aria-rowcount={total + 1}
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
                        const row = windowRows[virtualRow.index];
                        if (row === undefined) return null;
                        const { commit } = row;
                        const merge = merges.get(commit.oid);
                        return (
                          <CommitGraphRow
                            key={virtualRow.key}
                            commit={commit}
                            labels={
                              labelsByOid.get(commit.oid) ?? emptyRefLabels
                            }
                            lane={row.lane}
                            rowIndex={start + virtualRow.index + 2}
                            size={virtualRow.size}
                            start={virtualRow.start}
                            selected={navigation.selected.has(commit.oid)}
                            active={
                              navigation.selection.activeOid === commit.oid
                            }
                            merge={merge}
                            busy={
                              merge !== undefined &&
                              merge !== shownMerges.get(commit.oid) &&
                              failure === undefined
                            }
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </CommitActionMenu>
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
                    className="absolute inset-0 grid place-items-center text-[.85rem] text-muted-foreground"
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
        </AuthorAvatars>
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

function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-3 py-2">
      {children}
    </header>
  );
}
function Title({ repositoryName }: { readonly repositoryName: string }) {
  return (
    <h1 className="mr-auto min-w-0 max-w-48 truncate text-[.85rem] font-semibold text-foreground">
      {repositoryName}
    </h1>
  );
}
const CommitGraphToolbar = { Frame, Title };
