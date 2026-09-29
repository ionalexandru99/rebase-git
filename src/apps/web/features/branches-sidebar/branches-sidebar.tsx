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
import type { RepositoryRefTarget } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  everyAction,
  keyAction,
  replaceRuns,
  runAction,
} from "#web/components/ui/action-menu.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { treeKeyAction } from "#web/features/branches-sidebar/branches-sidebar-keyboard.ts";
import {
  RefRow,
  rowElementId,
  SectionRow,
} from "#web/features/branches-sidebar/branches-sidebar-rows.tsx";
import {
  type BranchesSidebarRefRow,
  type BranchesSidebarRow,
  type BranchesSidebarScope,
  branchesSidebarItems,
  buildBranchesSidebarRows,
  currentRefRowId,
  defaultExpandedSections,
  estimateItemHeight,
  refFolderIds,
  refRowId,
  refSectionId,
  scopeShowing,
  selectTagRows,
  toggleSection,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";
import { SidebarStatus } from "#web/features/branches-sidebar/sidebar-status.tsx";
import {
  BranchesSidebarScopeFilter,
  BranchesSidebarViewSelector,
  useBranchesSidebarView,
} from "#web/features/branches-sidebar/sidebar-view-controls.tsx";
import { historyRefKey } from "#web/features/commit-graph/scope/history-scope.ts";
import type { MergeActions } from "#web/features/merge/merge-actions.ts";
import type { RebaseActions } from "#web/features/rebase/rebase-actions.ts";
import {
  type RefAction,
  type RefActionRow,
  refActions,
  selectedTagActions,
  useRefIntent,
} from "#web/features/refs/ref-actions.ts";
import { useRefEditing } from "#web/features/refs/ref-editing.ts";
import { RefEditingStatus } from "#web/features/refs/ref-editing-status.tsx";
import {
  commitStartPoint,
  type RefKind,
} from "#web/features/refs/ref-kinds.ts";
import { RefEditField } from "#web/features/refs/ref-name-field.tsx";
import {
  useRefActivation,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import { TagDetails } from "#web/features/refs/tag-details.tsx";
import { TagPushStatus, useTagPush } from "#web/features/refs/tag-push.tsx";
import { usePull } from "#web/features/remote-sync/use-pull.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

const overscanRows = 12;
const noSelectedRefs: ReadonlySet<string> = new Set();
const noSelectedTags: ReadonlySet<string> = new Set();

export function BranchesSidebar({
  merge,
  rebase,
  onBranchRenamed = () => undefined,
  onToggleHistoryRef = () => undefined,
  onShowReflog,
  selectedHistoryRefKeys = noSelectedRefs,
}: {
  readonly merge?: MergeActions | undefined;
  readonly rebase?: RebaseActions | undefined;
  readonly onBranchRenamed?: (rename: {
    readonly name: string;
    readonly newName: string;
  }) => void;
  readonly onToggleHistoryRef?: (target: RepositoryRefTarget) => void;
  readonly onShowReflog?: (branch: string) => void;
  readonly selectedHistoryRefKeys?: ReadonlySet<string>;
}): JSX.Element {
  const activeWorktreePath = useRepositoryScope()?.worktreePath ?? "";
  const repositoryRefs = useScopedRepositoryRefs();
  const activation = useRefActivation(repositoryRefs);
  const pull = usePull();
  const tagPush = useTagPush();
  const [selectedTags, setSelectedTags] = useState(noSelectedTags);
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
  const reveal = useCallback((kind: RefKind, name: string) => {
    const sectionId = refSectionId(kind);
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
  }, []);
  const editing = useRefEditing({
    refs,
    focusTree,
    reveal,
    onCreated: (name) => onSelectRef({ _tag: "LocalBranch", name }),
    onRenamed: onBranchRenamed,
  });
  const edit = editing.edit;
  const draftSectionId =
    edit?.kind === "create" ? refSectionId(edit.ref) : undefined;
  useEffect(() => {
    if (draftSectionId !== undefined)
      setScope((current) => scopeShowing(current, draftSectionId));
  }, [draftSectionId]);
  const detailsRowId = rows.find(
    (row) =>
      row.id === activeRowId && row.kind === "ref" && row.target._tag === "Tag",
  )?.id;
  const items = useMemo(
    () => branchesSidebarItems(rows, draftSectionId, detailsRowId),
    [rows, draftSectionId, detailsRowId],
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
  useRefIntent((intent) => {
    if (intent._tag === "DraftRef") {
      editing.draft(intent.kind, commitStartPoint(intent.oid));
      return;
    }
    if (intent._tag === "RunRefAction") {
      const key = historyRefKey(intent.target);
      const row = rowsRef.current.find(
        (candidate) =>
          candidate.kind === "ref" && historyRefKey(candidate.target) === key,
      );
      runAction(
        everyAction(
          clearingNotices(
            refActionsFor(
              row?.kind === "ref"
                ? row
                : { id: key, name: intent.target.name, target: intent.target },
            ),
          ),
        ).find((action) => action.id === intent.id),
      );
      return;
    }
    treeRef.current?.focus();
    setActiveRowId(
      (current) =>
        current ?? currentRefRowId(rowsRef.current) ?? rowsRef.current[0]?.id,
    );
  });

  const refActionsFor = (row: RefActionRow) =>
    refs === undefined
      ? []
      : refActions(
          row,
          refs,
          { activeWorktreePath, writable: editing.writable },
          {
            checkout: onSelectRef,
            merge: merge?.actionFor,
            rebase: rebase?.actionFor,
            interactiveRebase: rebase?.interactiveFor,
            showReflog: onShowReflog,
            pull: pull.allowed
              ? {
                  pulling: pull.pulling,
                  run: (branch) => void pull.pull(branch),
                }
              : undefined,
            pushTags: tagPush.handler,
            editing,
          },
        );

  const actionsFor = (row: BranchesSidebarRefRow) =>
    clearingNotices(
      refs !== undefined && selectedTags.size > 1 && selectedTags.has(row.id)
        ? selectedTagActions(
            rows.flatMap((candidate) =>
              selectedTags.has(candidate.id) && candidate.kind === "ref"
                ? [candidate.name]
                : [],
            ),
            refs,
            { writable: editing.writable },
            tagPush.handler,
          )
        : refActionsFor(row),
    );

  const clearingNotices = (actions: readonly RefAction[]) =>
    replaceRuns(actions, (action) => () => {
      tagPush.dismiss();
      editing.dismissNotice();
      action.run();
    });

  const moveActive = (rowId: string | undefined) => {
    setSelectedTags(noSelectedTags);
    setActiveRowId(rowId);
  };

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
      activeRow?.kind === "ref" &&
      runAction(keyAction(actionsFor(activeRow), event.key))
    ) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && selectedTags.size > 0) {
      event.preventDefault();
      setSelectedTags(noSelectedTags);
      return;
    }
    const handled = treeKeyAction(event.key, {
      activeRow,
      collapse: (row) => setRowExpanded(row, false),
      expand: (row) => setRowExpanded(row, true),
      hasQuery: query.length > 0,
      rows,
      setActive: moveActive,
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
        aria-multiselectable="true"
        className={`group/tree min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-width:none] px-2 pb-2 outline-none [&::-webkit-scrollbar]:hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 ${activation.checkingOut ? "cursor-progress opacity-70" : ""}`}
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
            const editsRow =
              item.kind === "draft" ||
              (edit?.kind === "rename" && edit.rowId === item.id);
            if (editsRow)
              return (
                <div
                  className="absolute top-0 left-0 w-full"
                  data-index={virtualItem.index}
                  key={item.id}
                  ref={virtualizer.measureElement}
                  style={position}
                >
                  <RefEditField
                    editing={editing}
                    level={item.kind === "row" ? item.row.level : 2}
                    refs={refs}
                  />
                </div>
              );
            if (item.kind === "details") {
              const tag = refs?.tags.find(({ name }) => name === item.row.name);
              return tag === undefined ? null : (
                <div
                  className="absolute top-0 left-0 w-full"
                  data-index={virtualItem.index}
                  key={item.id}
                  ref={virtualizer.measureElement}
                  style={position}
                >
                  <TagDetails level={item.row.level} tag={tag} />
                </div>
              );
            }
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
                actions={actionsFor(row)}
                active={row.id === activeRowId}
                key={row.id}
                onActivate={(mode) => {
                  setSelectedTags((current) =>
                    selectTagRows(rows, current, activeRowId, row.id, mode),
                  );
                  setActiveRowId(row.id);
                  merge?.inspect(row.target);
                  rebase?.inspect(row.target);
                }}
                onToggleHistory={() => onToggleHistoryRef(row.target)}
                row={row}
                selected={selectedTags.has(row.id)}
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
      <RefEditingStatus checkoutError={activation.error} editing={editing} />
      <TagPushStatus push={tagPush} />
    </nav>
  );
}
