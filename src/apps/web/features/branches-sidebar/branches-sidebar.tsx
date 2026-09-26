import type { RepositoryRefTarget, RepositoryTag } from "@rebase/contracts";
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
import { Input } from "#web/components/ui/input";
import {
  branchesSidebarItems,
  estimateItemHeight,
  isBranchEditItem,
  refFolderIds,
  refRowId,
} from "#web/features/branches-sidebar/branch-editing/branch-edit-state";
import { BranchEditItem } from "#web/features/branches-sidebar/branch-editing/components/branch-edit-item";
import { BranchEditingStatus } from "#web/features/branches-sidebar/branch-editing/components/branch-editing-status";
import {
  type BranchRename,
  useBranchEditing,
} from "#web/features/branches-sidebar/branch-editing/hooks/use-branch-editing";
import {
  type BranchesSidebarRow,
  type BranchesSidebarScope,
  localBranchesSectionId,
  tagsSectionId,
} from "#web/features/branches-sidebar/branches-sidebar-model";
import {
  buildBranchesSidebarRows,
  currentRefRowId,
  defaultExpandedSections,
  scopeShowing,
  toggleSection,
} from "#web/features/branches-sidebar/branches-sidebar-state";
import {
  RefRow,
  rowElementId,
  SectionRow,
} from "#web/features/branches-sidebar/components/branches-sidebar-rows";
import { BranchesSidebarScopeFilter } from "#web/features/branches-sidebar/components/branches-sidebar-scope-filter";
import { BranchesSidebarViewSelector } from "#web/features/branches-sidebar/components/branches-sidebar-view-selector";
import { SidebarStatus } from "#web/features/branches-sidebar/components/sidebar-status";
import { useBranchesSidebarView } from "#web/features/branches-sidebar/hooks/use-branches-sidebar-view";
import type { RefCreateRequest } from "#web/features/branches-sidebar/hooks/use-create-ref-here";
import { treeKeyAction } from "#web/features/branches-sidebar/navigation/branches-sidebar-keyboard";
import { TagDraftRow } from "#web/features/branches-sidebar/tag-editing/components/tag-draft-row";
import { TagEditingStatus } from "#web/features/branches-sidebar/tag-editing/components/tag-editing-status";
import { useTagEditing } from "#web/features/branches-sidebar/tag-editing/hooks/use-tag-editing";
import { historyRefKey } from "#web/features/commit-graph/scope/history-scope";
import type { RefCommandDefinition } from "#web/features/ref-commands/ref-command";
import type { RefActivation } from "#web/features/repository-refs/hooks/use-ref-activation";
import type { RepositoryRefsRead } from "#web/features/repository-refs/hooks/use-repository-refs";

const overscanRows = 12;
const noRefCommands: readonly RefCommandDefinition[] = [];
const noTags: readonly RepositoryTag[] = [];

export function BranchesSidebar({
  activation,
  activeWorktreePath,
  createRequest,
  focusRequest,
  onBranchRenamed = () => undefined,
  onToggleHistoryRef = () => undefined,
  refCommands = noRefCommands,
  repositoryRefs,
  selectedHistoryRefKeys = new Set<string>(),
}: {
  readonly activation: RefActivation;
  readonly activeWorktreePath: string;
  readonly createRequest?: RefCreateRequest | undefined;
  readonly focusRequest: number;
  readonly onBranchRenamed?: (rename: BranchRename) => void;
  readonly onToggleHistoryRef?: (target: RepositoryRefTarget) => void;
  readonly refCommands?: readonly RefCommandDefinition[];
  readonly repositoryRefs: RepositoryRefsRead;
  readonly selectedHistoryRefKeys?: ReadonlySet<string>;
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
  const refs = repositoryRefs.refs;
  const onSelectRef = activation.select;
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
  const reveal = useCallback(
    (name: string, sectionId = localBranchesSectionId) => {
      setExpandedSections((current) =>
        current.has(sectionId) ? current : toggleSection(current, sectionId),
      );
      setExpandedFolders((current) => {
        const next = new Map(current);
        for (const id of refFolderIds(sectionId, name)) next.set(id, true);
        return next;
      });
      setActiveRowId(refRowId(sectionId, name));
      treeRef.current?.focus();
    },
    [],
  );
  const editing = useBranchEditing({
    activeWorktreePath,
    createRequest,
    focusTree,
    onCreated: (name) => onSelectRef({ _tag: "LocalBranch", name }),
    onRenamed: onBranchRenamed,
    refs,
    reveal,
  });
  const tagEditing = useTagEditing({
    createRequest,
    focusTree,
    reveal,
    tags: refs?.tags ?? noTags,
  });
  const draftSectionId = editing.draftSectionId ?? tagEditing.draftSectionId;
  useEffect(() => {
    if (draftSectionId !== undefined)
      setScope((current) => scopeShowing(current, draftSectionId));
  }, [draftSectionId]);
  const items = useMemo(
    () => branchesSidebarItems(rows, draftSectionId),
    [rows, draftSectionId],
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
    if (
      editing.handleTreeKey(event.key, activeRow) ||
      tagEditing.handleTreeKey(event.key, activeRow)
    ) {
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
        aria-busy={activation.checkingOut}
        aria-label="Branches"
        className={`group/tree min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-width:none] px-2 pb-2 outline-none [&::-webkit-scrollbar]:hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 ${activation.checkingOut ? "cursor-progress opacity-70" : ""}`}
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
                  {item.kind === "draft" && draftSectionId === tagsSectionId ? (
                    <TagDraftRow editing={tagEditing} />
                  ) : (
                    <BranchEditItem
                      branches={refs?.branches ?? []}
                      editing={editing}
                      item={item}
                    />
                  )}
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
                actions={[
                  ...editing.rowActions(row),
                  ...tagEditing.rowActions(row),
                ]}
                active={row.id === activeRowId}
                commands={refCommands}
                key={row.id}
                onAction={(id) => {
                  if (!tagEditing.start(id, row)) editing.start(id, row);
                }}
                onActivate={() => setActiveRowId(row.id)}
                onSelect={() => onSelectRef(row.target)}
                onToggleHistory={() => onToggleHistoryRef(row.target)}
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
          query={query}
          repositoryRefs={repositoryRefs}
          rows={rows}
          scope={scope}
        />
      </div>
      <BranchEditingStatus
        editing={editing}
        remoteBranches={refs?.remoteBranches ?? []}
      />
      <TagEditingStatus editing={tagEditing} />
      {activation.error === null ? null : (
        <p
          className="mx-3 mb-3 rounded-md border border-status-unavailable/40 bg-status-unavailable/10 px-3 py-2 text-xs text-foreground"
          role="alert"
        >
          {activation.error}
        </p>
      )}
    </nav>
  );
}
