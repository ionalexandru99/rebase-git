import type { RepositoryRefTarget } from "@rebase/contracts";
import { IconSearch } from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type JSX,
  type KeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  branchesSidebarItems,
  estimateItemHeight,
  isBranchEditItem,
  localBranchFolderIds,
  localBranchRowId,
} from "#web/features/branches-sidebar/branch-editing/branch-edit-state";
import { useBranchEditing } from "#web/features/branches-sidebar/branch-editing/hooks/use-branch-editing";
import {
  type BranchesSidebarRow,
  type BranchesSidebarScope,
  localBranchesSectionId,
} from "#web/features/branches-sidebar/branches-sidebar.contract";
import { describeRepositoryRefsError } from "#web/features/branches-sidebar/branches-sidebar-messages";
import {
  buildBranchesSidebarRows,
  currentRefRowId,
  defaultExpandedSections,
  toggleSection,
} from "#web/features/branches-sidebar/branches-sidebar-state";
import { useBranchesSidebarView } from "#web/features/branches-sidebar/hooks/use-branches-sidebar-view";
import { treeKeyAction } from "#web/features/branches-sidebar/navigation/branches-sidebar-keyboard";
import { historyRefKey } from "#web/features/commit-graph/index";
import { useRepositoryPull } from "#web/features/repository-pull/index";
import type { RepositoryRefsSnapshot } from "#web/features/repository-refs/repository-refs-controller.contract";
import { Input } from "#web-ui/components/ui/input";
import { BranchEditItem } from "#web-ui/features/branches-sidebar/branch-editing/components/branch-edit-item";
import { BranchEditingStatus } from "#web-ui/features/branches-sidebar/branch-editing/components/branch-editing-status";
import {
  RefRow,
  rowElementId,
  SectionRow,
} from "#web-ui/features/branches-sidebar/components/branches-sidebar-rows";
import { BranchesSidebarScopeFilter } from "#web-ui/features/branches-sidebar/components/branches-sidebar-scope-filter";
import { BranchesSidebarViewSelector } from "#web-ui/features/branches-sidebar/components/branches-sidebar-view-selector";
import { SidebarStatus } from "#web-ui/features/branches-sidebar/components/sidebar-status";

const overscanRows = 12;

export function BranchesSidebar({
  activeWorktreePath,
  focusRequest,
  onRetry,
  onSelectRef,
  onToggleHistoryRef = () => undefined,
  selectedHistoryRefKeys = new Set<string>(),
  snapshot,
}: {
  readonly activeWorktreePath: string;
  readonly focusRequest: number;
  readonly onRetry: () => void;
  readonly onSelectRef: (target: RepositoryRefTarget) => void;
  readonly onToggleHistoryRef?: (target: RepositoryRefTarget) => void;
  readonly selectedHistoryRefKeys?: ReadonlySet<string>;
  readonly snapshot: RepositoryRefsSnapshot;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const filterQuery = useDeferredValue(query);
  const [scope, setScope] = useState<BranchesSidebarScope>("all");
  const [expandedSections, setExpandedSections] = useState(
    defaultExpandedSections,
  );
  const [view, setView] = useBranchesSidebarView();
  const [expandedFolders, setExpandedFolders] = useState<
    ReadonlyMap<string, boolean>
  >(() => new Map());
  const [activeRowId, setActiveRowId] = useState<string>();
  const treeRef = useRef<HTMLDivElement>(null);
  const refs = snapshot.refs;
  const folderRepositoryRef = useRef(refs?.repositoryId);
  useEffect(() => {
    if (folderRepositoryRef.current === refs?.repositoryId) return;
    folderRepositoryRef.current = refs?.repositoryId;
    setExpandedFolders(new Map());
  }, [refs?.repositoryId]);
  const rows = useMemo(
    () =>
      refs === undefined
        ? []
        : buildBranchesSidebarRows(
            refs,
            activeWorktreePath,
            expandedSections,
            filterQuery,
            scope,
            { view, folders: expandedFolders },
          ),
    [
      activeWorktreePath,
      expandedSections,
      expandedFolders,
      filterQuery,
      refs,
      scope,
      view,
    ],
  );
  const focusTree = useCallback(() => treeRef.current?.focus(), []);
  const reveal = useCallback((name: string) => {
    setExpandedSections((current) =>
      current.has(localBranchesSectionId)
        ? current
        : toggleSection(current, localBranchesSectionId),
    );
    setExpandedFolders((current) => {
      const next = new Map(current);
      for (const id of localBranchFolderIds(name)) next.set(id, true);
      return next;
    });
    setActiveRowId(localBranchRowId(name));
    treeRef.current?.focus();
  }, []);
  const pull = useRepositoryPull();
  const editing = useBranchEditing({
    activeWorktreePath,
    focusTree,
    refs,
    reveal,
  });
  const items = useMemo(
    () => branchesSidebarItems(rows, editing.edit),
    [rows, editing.edit],
  );
  const getItemKey = useCallback(
    (index: number) => items[index]?.id ?? index,
    [items],
  );
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: (index) => estimateItemHeight(items[index]),
    getItemKey,
    getScrollElement: () => treeRef.current,
    overscan: overscanRows,
  });
  useLayoutEffect(() => {
    if (items.length > 0) virtualizer.measure();
  }, [items, virtualizer]);

  const draftIndex = items.findIndex((item) => item.kind === "draft");
  useEffect(() => {
    if (draftIndex >= 0) virtualizer.scrollToIndex(draftIndex);
  }, [draftIndex, virtualizer]);

  const activeIndexRef = useRef(-1);
  useEffect(() => {
    const index = rows.findIndex((row) => row.id === activeRowId);
    if (index >= 0) activeIndexRef.current = index;
    else if (activeRowId !== undefined)
      setActiveRowId(
        rows[Math.min(activeIndexRef.current, rows.length - 1)]?.id,
      );
  }, [activeRowId, rows]);

  useEffect(() => {
    if (activeRowId === undefined) return;
    const index = items.findIndex((item) => item.id === activeRowId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [activeRowId, items, virtualizer]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    if (focusRequest === 0) return;
    treeRef.current?.focus();
    setActiveRowId(
      (current) =>
        current ?? currentRefRowId(rowsRef.current) ?? rowsRef.current[0]?.id,
    );
  }, [focusRequest]);

  const setRowExpanded = (
    row: Exclude<BranchesSidebarRow, { kind: "ref" }>,
    expanded: boolean,
  ) => {
    if (row.kind === "folder") {
      setExpandedFolders((current) => new Map(current).set(row.id, expanded));
    } else {
      setExpandedSections((current) =>
        current.has(row.sectionId) === expanded
          ? current
          : toggleSection(current, row.sectionId),
      );
    }
  };

  const activateRow = (row: BranchesSidebarRow) => {
    if (row.kind === "ref") onSelectRef(row.target);
    else setRowExpanded(row, !row.expanded);
  };

  const openRowMenu = (rowId: string) => {
    const row = document.getElementById(rowElementId(rowId));
    if (row === null) return;
    const bounds = row.getBoundingClientRect();
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: bounds.left + 32,
        clientY: bounds.bottom,
      }),
    );
  };

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const activeRow = rows.find((row) => row.id === activeRowId);
    if (
      activeRow?.kind === "ref" &&
      (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
    ) {
      event.preventDefault();
      openRowMenu(activeRow.id);
      return;
    }
    if (editing.handleTreeKey(event.key, activeRow)) {
      event.preventDefault();
      return;
    }
    const handled = treeKeyAction(event.key, {
      activeRow,
      collapse: (row) => setRowExpanded(row, false),
      expand: (row) => setRowExpanded(row, true),
      hasQuery: query.length > 0,
      rows,
      setActive: setActiveRowId,
      toggleHistoryRef: (row) => onToggleHistoryRef(row.target),
      activate: activateRow,
      clearQuery: () => setQuery(""),
    });
    if (handled) event.preventDefault();
  };

  const handleFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      treeRef.current?.focus();
      setActiveRowId(
        (current) => current ?? currentRefRowId(rows) ?? rows[0]?.id,
      );
      return;
    }
    if (event.key === "Enter") {
      const activeRow = rows.find((row) => row.id === activeRowId);
      if (activeRow?.kind === "ref") {
        event.preventDefault();
        onSelectRef(activeRow.target);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (query.length > 0) setQuery("");
      else treeRef.current?.focus();
    }
  };

  return (
    <nav
      aria-label="Branches"
      className="flex h-full min-h-0 flex-col overflow-hidden border-sidebar-border/50 border-r bg-sidebar text-sidebar-foreground"
    >
      <div className="flex h-11 shrink-0 items-center px-4 text-sidebar-accent-foreground">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          Branches
        </h2>
        <BranchesSidebarViewSelector view={view} onChange={setView} />
      </div>
      <div className="relative mx-3 mt-3">
        <IconSearch
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Filter branches"
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleFilterKeyDown}
          placeholder="Filter branches"
          value={query}
        />
      </div>
      <BranchesSidebarScopeFilter onChange={setScope} scope={scope} />
      <div
        aria-activedescendant={
          activeRowId === undefined ? undefined : rowElementId(activeRowId)
        }
        aria-busy={snapshot.checkingOut}
        aria-label="Branches"
        className={`group/tree min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-width:none] px-2 pb-2 outline-none [&::-webkit-scrollbar]:hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 ${snapshot.checkingOut ? "cursor-progress opacity-70" : ""}`}
        data-slot="branches-scroll"
        onKeyDown={handleTreeKeyDown}
        ref={treeRef}
        role="tree"
        tabIndex={0}
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = items[virtualItem.index];
            if (item === undefined) return null;
            const position = {
              transform: `translateY(${virtualItem.start}px)`,
            };
            if (isBranchEditItem(item, editing.edit))
              return (
                <div
                  className="absolute top-0 left-0 w-full"
                  data-index={virtualItem.index}
                  key={item.id}
                  ref={virtualizer.measureElement}
                  style={position}
                >
                  <BranchEditItem
                    branches={refs?.branches ?? []}
                    editing={editing}
                    item={item}
                  />
                </div>
              );
            if (item.kind !== "row") return null;
            const row = item.row;
            const style = { ...position, height: virtualItem.size };
            return row.kind !== "ref" ? (
              <SectionRow
                active={row.id === activeRowId}
                key={row.id}
                onActivate={() => setActiveRowId(row.id)}
                onToggle={() => activateRow(row)}
                row={row}
                style={style}
              />
            ) : (
              <RefRow
                actions={editing.rowActions(row)}
                active={row.id === activeRowId}
                key={row.id}
                onAction={(id) => editing.start(id, row)}
                onActivate={() => setActiveRowId(row.id)}
                onPull={
                  pull?.allowed === true
                    ? () => pull.execute(row.name)
                    : undefined
                }
                onSelect={() => onSelectRef(row.target)}
                onToggleHistory={() => onToggleHistoryRef(row.target)}
                pulling={pull?.pulling ?? false}
                row={row}
                selectedInHistory={selectedHistoryRefKeys.has(
                  historyRefKey(row.target),
                )}
                style={style}
              />
            );
          })}
        </div>
        <SidebarStatus
          onRetry={onRetry}
          query={query}
          rows={rows}
          scope={scope}
          snapshot={snapshot}
        />
      </div>
      <BranchEditingStatus
        editing={editing}
        remoteBranches={refs?.remoteBranches ?? []}
      />
      {snapshot.checkoutError === undefined ? null : (
        <p
          className="mx-3 mb-3 rounded-md border border-status-unavailable/40 bg-status-unavailable/10 px-3 py-2 text-xs text-foreground"
          role="alert"
        >
          {describeRepositoryRefsError(snapshot.checkoutError)}
        </p>
      )}
    </nav>
  );
}

function openRowMenu(rowId: string) {
  const row = document.getElementById(rowElementId(rowId));
  if (row === null) return;
  const bounds = row.getBoundingClientRect();
  row.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      clientX: bounds.left + 32,
      clientY: bounds.top + bounds.height / 2,
    }),
  );
}
